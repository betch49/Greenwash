// Criteria 10.3 and 10.5: the offline harness runs end to end on the fixture subset
// (no network), writes a results JSON that parses, and RESULTS.md carries the AUC line,
// n per group, the coverage table and the partial-run sentence; a brand whose run
// throws is recorded as failed and the harness continues.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RunsRepo } from "@/lib/db/runs-repo";
import type { Fetcher } from "@/lib/fetch/fetcher";
import { MockLLM } from "@/lib/llm/mock";
import { loadGroundTruth, type Entry } from "@/lib/validation/ground-truth";
import { hasFixture, runHarness, type BrandResult } from "@/lib/validation/harness";
import { ResultsSchema, partialSentence, summarise, writeResults, type Results } from "@/lib/validation/report";
import { OfflineFetcher } from "../helpers/brands";
import { tempDb } from "../helpers/db";

const NOW = () => new Date("2026-10-21T12:00:00Z");
const meta = { mode: "offline" as const, generatedAt: new Date("2026-10-21T12:00:00Z"), commit: "test", commitDirty: false, weightsVersion: 1, llm: "MockLLM" };

describe("offline harness on the fixture subset (10.3)", () => {
  const { db, cleanup } = tempDb();
  const out = mkdtempSync(join(tmpdir(), "gr-validation-"));
  const gt = loadGroundTruth();
  const fetcher = new OfflineFetcher();
  let results: BrandResult[];
  let summary: Results;

  beforeAll(async () => {
    results = await runHarness(gt.entries, { mode: "offline", services: { db, runs: new RunsRepo(db), fetcher, llm: new MockLLM("fixtures/llm"), now: NOW } });
    summary = summarise(gt, gt.entries, results, meta);
    writeResults(out, summary);
  }, 180_000);
  afterAll(() => {
    cleanup();
    rmSync(out, { recursive: true, force: true });
  });

  it("the fixture subset has at least 2 flagged and 2 well-rated brands besides the v1 fixture brands", () => {
    const v1 = new Set(["mammut", "fairphone", "oatly"]);
    const fx = gt.entries.filter((e) => hasFixture(e));
    expect(fx.filter((e) => e.group === "flagged" && !v1.has(e.fixture!)).length).toBeGreaterThanOrEqual(2);
    expect(fx.filter((e) => e.group === "well_rated" && !v1.has(e.fixture!)).length).toBeGreaterThanOrEqual(2);
  });

  it("runs every fixture brand offline (only fixture URLs fetched) and skips the others as not_run", () => {
    for (const r of results) {
      const e = gt.entries.find((x) => x.slug === r.slug)!;
      if (hasFixture(e)) expect(r.status, `${r.slug}: ${r.reason}`).toBe("ran");
      else expect(r.status).toBe("not_run");
    }
    expect(fetcher.calls.length).toBeGreaterThan(0);
  });

  it("writes a results JSON that parses against the results schema", () => {
    const files = readdirSync(out).filter((f) => f.endsWith(".json"));
    expect(files).toEqual(["results-2026-10-21-offline.json"]);
    const parsed = ResultsSchema.parse(JSON.parse(readFileSync(join(out, files[0]), "utf8")));
    expect(parsed.mode).toBe("offline");
    expect(parsed.label_use).toBe("evaluation_only");
    expect(parsed.n_ran).toBe(results.filter((r) => r.status === "ran").length);
    expect(parsed.n_flagged_ran).toBeGreaterThanOrEqual(3);
    expect(parsed.n_well_rated_ran).toBeGreaterThanOrEqual(2);
    expect(parsed.stats.auc).not.toBeNull();
  });

  it("RESULTS.md has the AUC line, n per group, the coverage table and the partial-run sentence", () => {
    const md = readFileSync(join(out, "RESULTS.md"), "utf8");
    expect(md).toMatch(/AUC \(flagged vs well-rated, overall score\): \d\.\d\d \(n flagged = \d+, n well-rated = \d+\)/);
    expect(md).toContain(`n flagged = ${summary.n_flagged_ran}, n well-rated = ${summary.n_well_rated_ran}`);
    expect(md).toContain("| Brand | Group | Status | Score |");
    for (const r of results) expect(md).toContain(`| ${r.name.replace(/\|/g, "\\|")} | ${r.group} | ${r.status} |`);
    expect(summary.n_ran).toBeLessThan(gt.entries.length);
    expect(md).toContain(partialSentence(summary.n_ran, gt.entries.length));
    expect(md).toContain("Ground-truth labels are used for evaluation only and never enter the score.");
  });

  it("the pipeline never sees the label: the stored runs hold brand, website and entity only", () => {
    const rows = db.$client.prepare("select brand, website, entity_json as entity from runs").all() as { brand: string; website: string; entity: string | null }[];
    expect(rows.length).toBe(results.filter((r) => r.status !== "not_run").length);
    for (const row of rows) expect(`${row.brand} ${row.website} ${row.entity ?? ""}`).not.toMatch(/well_rated|flagged|contested|evaluation_only/);
  });
});

describe("a brand whose run throws (10.5)", () => {
  const { db, cleanup } = tempDb();
  afterAll(cleanup);

  const entry = (slug: string, group: Entry["group"]): Entry => ({
    slug,
    name: slug,
    website: `https://www.${slug}.com/`,
    group,
    citations: [{ source: "changing_markets", role: "flag", url: `https://greenwash.com/brands/${slug}`, date: "2026-10-21", why: "w", verified_from_container: true }],
    checks: [],
  });

  it("is recorded as failed with the reason, the harness continues, and it is counted in n_failed, never in the AUC sample", async () => {
    const throwing: Fetcher = {
      get: async (url) => {
        throw new Error(`network down for ${url}`);
      },
    };
    const entries = [entry("alpha", "flagged"), entry("beta", "well_rated"), entry("gamma", "flagged")];
    const results = await runHarness(entries, {
      mode: "offline",
      services: { db, runs: new RunsRepo(db), fetcher: throwing, llm: null, now: NOW },
      resolve: async (e) => {
        if (e.slug === "gamma") throw new Error("Wikidata exploded");
        return { brand: e.name, website: e.website, resolution: "website" };
      },
    });
    expect(results.map((r) => r.status)).toEqual(["failed", "failed", "failed"]);
    expect(results[0].reason).toMatch(/no page could be fetched/);
    expect(results[2].reason).toBe("Wikidata exploded");
    const s = summarise({ version: 1, label_use: "evaluation_only", entries }, entries, results, meta);
    expect(s.n_failed).toBe(3);
    expect(s.n_ran).toBe(0);
    expect(s.n_flagged_ran).toBe(0);
    expect(s.stats.auc).toBeNull();
    expect(s.partial).toBe(partialSentence(0, 3));
  });

  it("a mix: the failed brand stays out of the AUC sample", () => {
    const mk = (slug: string, group: Entry["group"], status: BrandResult["status"], score?: number): BrandResult => ({
      slug,
      name: slug,
      group,
      status,
      ...(score !== undefined ? { score } : {}),
      pages: status === "ran" ? 3 : 0,
      words_scanned: status === "ran" ? 1000 : 0,
      claim_matches: 0,
      steps: [],
      steps_done: 0,
      steps_skipped: 0,
      duration_ms: 1,
    });
    const entries = [entry("a", "flagged"), entry("b", "well_rated"), entry("c", "flagged")];
    const results = [mk("a", "flagged", "ran", 40), mk("b", "well_rated", "ran", 10), { ...mk("c", "flagged", "failed", 0), reason: "boom" }];
    const s = summarise({ version: 1, label_use: "evaluation_only", entries }, entries, results, meta);
    expect(s.n_failed).toBe(1);
    expect(s.n_flagged_ran).toBe(1);
    expect(s.stats.auc).toBe(1);
  });
});
