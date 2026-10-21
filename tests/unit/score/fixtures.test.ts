import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReportsRepo } from "@/lib/db/reports-repo";
import { RunOutputsRepo } from "@/lib/db/run-outputs-repo";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import { runPipeline, type PipelineOutcome } from "@/lib/pipeline/run";
import { ReportV1Schema } from "@/lib/score/report";
import { OfflineFetcher } from "../helpers/brands";
import { tempDb } from "../helpers/db";

const NOW = () => new Date("2026-10-20T12:00:00Z");
const meta = (slug: string) =>
  JSON.parse(readFileSync(join("fixtures", "brands", slug, "meta.json"), "utf8")) as { query: string; website: string; entity: { id: string | null; name: string; industry?: string } };

/**
 * Pinned per-brand results on the offline fixtures (Phase 3 review carry-forward: the scorer
 * fixtures pin the numbers). A change to a rule, a fixture or config/weights.json that moves
 * any of these must update this table and docs/phases/6.md together.
 */
const EXPECTED = {
  mammut: {
    score: 12,
    label: "low",
    confidence: 70,
    kinds: { "claims:claim.unsupported": 10, "evidence:evidence.report_found": 1, "repair:repair.warranty_found": 1 },
    axes: { claims: "scored:48", evidence: "scored:0", track: "missing:0", repair: "scored:0" },
  },
  fairphone: {
    score: 3,
    label: "low",
    confidence: 70,
    kinds: {
      "claims:claim.unsupported": 9,
      "claims:claim.supported": 5,
      "evidence:evidence.report_found": 1,
      "repair:repair.manual_found": 1,
      "repair:repair.spare_parts_found": 1,
      "repair:repair.program_found": 1,
      "repair:repair.warranty_found": 1,
      "repair:repair.ifixit_devices": 1,
      "repair:repair.ifixit_guides": 2,
      "repair:repair.ifixit_score": 2,
      "repair:repair.fr_index_found": 1,
    },
    axes: { claims: "scored:10", evidence: "scored:0", track: "missing:0", repair: "scored:0" },
  },
  oatly: {
    score: 35,
    label: "moderate",
    confidence: 100,
    kinds: { "claims:claim.unsupported": 60, "claims:claim.supported": 6, "evidence:evidence.report_found": 1, "track:regulator.ruling": 1 },
    axes: { claims: "scored:51", evidence: "scored:0", track: "scored:50", repair: "not_applicable:0" },
  },
  // Fictional, test-only (ADR-011): exercises claim.removed and the protective evidence kinds.
  // Phase 7 (ADR-017): a second removal, 2025 archived copy → live page, so track 20 → 40 and score 31 → 37.
  // This table is the rule-only baseline (no LLM client); tests/unit/llm/ai-share-fixtures.test.ts covers the LLM run.
  northwind: {
    score: 37,
    label: "moderate",
    confidence: 100,
    kinds: {
      "claims:claim.unsupported": 9,
      "claims:claim.supported": 3,
      "evidence:evidence.report_found": 1,
      "evidence:evidence.absolute_emissions_found": 1,
      "evidence:evidence.supplier_list_found": 1,
      "track:claim.removed": 2,
      "repair:repair.manual_found": 1,
      "repair:repair.spare_parts_found": 1,
      "repair:repair.program_found": 1,
      "repair:repair.warranty_found": 1,
    },
    axes: { claims: "scored:100", evidence: "scored:0", track: "scored:40", repair: "scored:0" },
  },
};

describe("each fixture brand ⇒ a valid ReportV1 (6.6)", () => {
  const env = tempDb();
  const out = new Map<string, PipelineOutcome>();
  let reports: ReportsRepo;
  beforeAll(async () => {
    const runs = new RunsRepo(env.db);
    reports = new ReportsRepo(env.db);
    for (const slug of Object.keys(EXPECTED)) {
      const m = meta(slug);
      const run = runs.create({ query: m.query, brand: m.entity.name, website: m.website, wikidataId: m.entity.id, entity: m.entity });
      out.set(slug, await runPipeline(run, { runs, pages: new RunPagesRepo(env.db), outputs: new RunOutputsRepo(env.db), reports, fetcher: new OfflineFetcher(), now: NOW }));
    }
  }, 60_000);
  afterAll(() => env.cleanup());

  for (const slug of Object.keys(EXPECTED) as (keyof typeof EXPECTED)[]) {
    it(`${slug}: valid ReportV1, ai_share reported, confidence 0–100, could_not_check non-empty, stored`, () => {
      const o = out.get(slug)!;
      expect(o.status).toBe("done");
      const report = ReportV1Schema.parse(o.report);
      expect(report.ai_share).toBeGreaterThanOrEqual(0);
      expect(report.ai_share).toBeLessThanOrEqual(0.5);
      expect(report.confidence).toBeGreaterThanOrEqual(0);
      expect(report.confidence).toBeLessThanOrEqual(100);
      expect(report.could_not_check.length).toBeGreaterThan(0);
      expect(report.signals_count).toBe(report.axes.reduce((n, a) => n + a.signals.length, 0));
      expect(reports.get(o.report_id!)).toEqual(report);
      expect(reports.getByRun(report.run_id)?.report).toEqual(report);
      const kinds: Record<string, number> = {};
      for (const a of report.axes) for (const s of a.signals) kinds[`${a.id}:${s.kind}`] = (kinds[`${a.id}:${s.kind}`] ?? 0) + 1;
      const e = EXPECTED[slug];
      expect({ score: report.score, label: report.label, confidence: report.confidence, ai_share: report.ai_share }).toEqual({ score: e.score, label: e.label, confidence: e.confidence, ai_share: 0 });
      expect(kinds).toEqual(e.kinds);
      expect(Object.fromEntries(report.axes.map((a) => [a.id, `${a.status}:${a.subscore}`]))).toEqual(e.axes);
      expect(report.llm_signal_ids).toEqual([]);
    });
  }
});

