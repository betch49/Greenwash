// PLAN criterion 7.6 (reworded by ADR-017): with the recorded LLM fixtures active, ai_share ≤ 0.5 for the
// three real fixture brands and for the fictional removed-claim brand Northwind, and > 0 for Northwind.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReportsRepo } from "@/lib/db/reports-repo";
import { RunOutputsRepo } from "@/lib/db/run-outputs-repo";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import { MockLLM } from "@/lib/llm/mock";
import { runPipeline, type PipelineOutcome } from "@/lib/pipeline/run";
import { ReportV1Schema } from "@/lib/score/report";
import { OfflineFetcher } from "../helpers/brands";
import { tempDb } from "../helpers/db";

const NOW = () => new Date("2026-10-20T12:00:00Z");
const FIXTURES = join("fixtures", "llm");
const meta = (slug: string) => JSON.parse(readFileSync(join("fixtures", "brands", slug, "meta.json"), "utf8")) as { query: string; website: string; entity: { id: string | null; name: string } };

/** Pinned results with the fixtures (docs/phases/7.md). Rule-only baselines: tests/unit/score/fixtures.test.ts. */
const EXPECTED: Record<string, { score: number; ai_share: number; llm_signals: number }> = {
  mammut: { score: 12, ai_share: 0, llm_signals: 0 },
  fairphone: { score: 3, ai_share: 0, llm_signals: 0 },
  oatly: { score: 35, ai_share: 0, llm_signals: 0 },
  // 2021→2024 removal confirmed (claim_removed, 20 points) + 2025→live removal "unsure" (halved, 10 points), both AI-assisted:
  // track 30 × 0.30 = 9 of 34 ⇒ 9/34.
  northwind: { score: 34, ai_share: 9 / 34, llm_signals: 2 },
};

describe("ai_share on the fixture brands with LLM fixtures active (7.6)", () => {
  const env = tempDb();
  const out = new Map<string, PipelineOutcome>();
  let mock: MockLLM;
  beforeAll(async () => {
    const runs = new RunsRepo(env.db);
    mock = new MockLLM(FIXTURES);
    for (const slug of Object.keys(EXPECTED)) {
      const m = meta(slug);
      const run = runs.create({ query: m.query, brand: m.entity.name, website: m.website, wikidataId: m.entity.id, entity: m.entity });
      out.set(slug, await runPipeline(run, { runs, pages: new RunPagesRepo(env.db), outputs: new RunOutputsRepo(env.db), reports: new ReportsRepo(env.db), fetcher: new OfflineFetcher(), now: NOW, llm: mock }));
    }
  }, 60_000);
  afterAll(() => env.cleanup());

  for (const slug of Object.keys(EXPECTED)) {
    it(`${slug}: ai_share ≤ 0.5${slug === "northwind" ? " and > 0" : ""}; every LLM call answered from a fixture; summary accepted`, () => {
      const r = ReportV1Schema.parse(out.get(slug)!.report);
      const e = EXPECTED[slug];
      expect(r.ai_share).toBeLessThanOrEqual(0.5);
      expect(r.score).toBe(e.score);
      expect(r.ai_share).toBeCloseTo(e.ai_share, 10);
      if (slug === "northwind") expect(r.ai_share).toBeGreaterThan(0);
      expect(r.llm_signal_ids).toHaveLength(e.llm_signals);
      // The offline flow exercises the calls (classify-diff only where a removal exists: the real brands have no recorded archive history).
      const names = new Set(r.llm_calls.map((c) => c.name));
      expect(names.has("extract") && names.has("summary")).toBe(true);
      if (slug === "northwind") expect(names.has("classify-diff")).toBe(true);
      expect(r.llm_calls.every((c) => c.used_fixture && c.status === "ok")).toBe(true);
      expect(r.summary?.text.length).toBeGreaterThan(0);
      // The summary cites fetched URLs only.
      for (const u of r.summary!.cited_urls) expect(r.axes.flatMap((a) => a.signals).some((s) => s.source_url === u)).toBe(true);
    });
  }

  it("no fixture was missing, and every fixture file says where it came from", () => {
    expect(mock.missing).toEqual([]);
    for (const f of readdirSync(FIXTURES).filter((x) => x.endsWith(".json"))) {
      const fx = JSON.parse(readFileSync(join(FIXTURES, f), "utf8"));
      expect(f.startsWith(`${fx.name}-`)).toBe(true);
      expect(f).toBe(`${fx.name}-${fx.input_sha1.slice(0, 12)}.json`);
      expect(fx.source).toMatch(/hand-authored stand-in|recorded with/);
    }
  });
});
