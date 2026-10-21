// Criterion 10.6: RESULTS.md reports the leakage line, with the number hand-computed
// on a 4-entry fixture; plus the history table that keeps earlier results.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Citation, Entry, GroundTruth } from "@/lib/validation/ground-truth";
import type { BrandResult } from "@/lib/validation/harness";
import { flaggedOnlyByPipeline, leakageLine, PIPELINE_SOURCES, renderClaimsComparison, renderResultsMd, summarise, writeResults } from "@/lib/validation/report";

const cite = (source: Citation["source"], role: Citation["role"] = "flag"): Citation => ({ source, role, url: `https://${source}.test/x`, date: "2026-10-21", why: "w", verified_from_container: true });
const entry = (slug: string, group: Entry["group"], citations: Citation[]): Entry => ({ slug, name: slug, website: `https://www.${slug}.com/`, group, citations, checks: [] });

// Hand count: a (ASA only) and c (ASA + JDP) are flagged only by pipeline sources ⇒ 2;
// b also has greenwash.com ⇒ not; d is well-rated ⇒ not counted. 2 of 3 flagged entries.
const ENTRIES = [
  entry("a", "flagged", [cite("asa")]),
  entry("b", "flagged", [cite("asa"), cite("changing_markets")]),
  entry("c", "flagged", [cite("asa"), cite("jdp")]),
  entry("d", "well_rated", [cite("sbti", "positive"), cite("netzerotracker", "positive")]),
];
const GT: GroundTruth = { version: 1, label_use: "evaluation_only", entries: ENTRIES };

const result = (slug: string, group: Entry["group"], status: BrandResult["status"], score?: number): BrandResult => ({
  slug,
  name: slug,
  group,
  status,
  ...(score !== undefined ? { score, axes: [{ id: "claims", status: "scored", subscore: score }] } : {}),
  pages: status === "ran" ? 2 : 0,
  words_scanned: status === "ran" ? 500 + (score ?? 0) : 0,
  claim_matches: score ?? 0,
  steps: [{ step: "Fetching pages", status: "done" }],
  steps_done: 1,
  steps_skipped: 0,
  duration_ms: 5,
});
const RESULTS = [result("a", "flagged", "ran", 50), result("b", "flagged", "failed"), result("c", "flagged", "ran", 20), result("d", "well_rated", "ran", 30)];
const meta = { mode: "offline" as const, generatedAt: new Date("2026-10-21T12:00:00Z"), commit: "abc1234", commitDirty: false, weightsVersion: 1, llm: "MockLLM" };

describe("leakage line (10.6)", () => {
  it("pipeline sources are ASA, JDP, SBTi and Sabin after Phases 11 and 13", () => {
    expect([...PIPELINE_SOURCES]).toEqual(["asa", "jdp", "sbti", "sabin"]);
    // An entry flagged only by SBTi and Sabin citations is pipeline-only; greenwash.com breaks it.
    expect(flaggedOnlyByPipeline(entry("e", "flagged", [cite("sbti"), cite("sabin")]))).toBe(true);
    expect(flaggedOnlyByPipeline(entry("f", "flagged", [cite("sabin"), cite("changing_markets")]))).toBe(false);
    expect(ENTRIES.map((e) => flaggedOnlyByPipeline(e))).toEqual([true, false, true, false]);
  });

  const dir = mkdtempSync(join(tmpdir(), "gr-report-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("RESULTS.md carries the hand-computed number", () => {
    const s = summarise(GT, ENTRIES, RESULTS, meta);
    expect(s.leakage.flagged_total).toBe(3);
    expect(s.leakage.flagged_only_pipeline_sources).toBe(2);
    // ran flagged: a and c, both pipeline-only
    expect(s.leakage.flagged_ran).toBe(2);
    expect(s.leakage.flagged_ran_only_pipeline_sources).toBe(2);
    writeResults(dir, s);
    const md = readFileSync(join(dir, "RESULTS.md"), "utf8");
    expect(md).toContain("Leakage: 2 of 3 flagged entries are flagged only by sources the pipeline itself queries (ASA, JDP, SBTI, SABIN)");
    expect(md).toContain(leakageLine(s));
  });

  it("stats on the same fixture: AUC 0.5 (50 > 30, 20 < 30), n per group, partial sentence", () => {
    const s = summarise(GT, ENTRIES, RESULTS, meta);
    expect(s.stats.auc).toBe(0.5);
    expect(s.n_flagged_ran).toBe(2);
    expect(s.n_well_rated_ran).toBe(1);
    expect(s.n_failed).toBe(1);
    expect(s.stats.mean_difference).toBe(5);
    expect(s.stats.per_axis.claims).toEqual({ auc: 0.5, n_flagged: 2, n_well_rated: 1 });
    expect(s.stats.per_axis.track).toEqual({ auc: null, n_flagged: 0, n_well_rated: 0 });
    expect(s.partial).toBe("Partial run: 3 of 4 brands produced a report.");
    expect(s.notes.join(" ")).toMatch(/Fewer than 5 reports in a group/);
  });

  it("a live run with fewer than 5 reports per group says the offline result stands", () => {
    const s = summarise(GT, ENTRIES, RESULTS, { ...meta, mode: "live" });
    expect(s.notes.join(" ")).toContain("the offline result stands as the only separation figure");
  });

  it("the history table keeps every results file, oldest first", () => {
    const a = summarise(GT, ENTRIES, RESULTS, meta);
    const b = summarise(GT, ENTRIES, RESULTS, { ...meta, generatedAt: new Date("2026-11-02T00:00:00Z"), commit: "def5678", weightsVersion: 2 });
    const md = renderResultsMd([
      { file: "results-2026-11-02-offline.json", results: b },
      { file: "results-2026-10-21-offline.json", results: a },
    ]);
    expect(md.indexOf("results-2026-10-21-offline.json")).toBeLessThan(md.indexOf("results-2026-11-02-offline.json"));
    expect(md).toContain("| 2026-11-02 | offline | `def5678` | 2 |");
    expect(md).toContain("No live run recorded yet.");
  });
});

// Phase 14 (criterion 14.5): the "Claims formula v1 vs v2" table with both AUC values and the Spearman diagnostic.
describe("claims formula v1 vs v2 table (14.5)", () => {
  const v1 = summarise(GT, ENTRIES, RESULTS, { ...meta, claimsVersion: 1 });
  const v2Results = RESULTS.map((r) => (r.slug === "a" ? { ...r, score: 10, axes: [{ id: "claims", status: "insufficient_data", subscore: 0 }] } : r));
  const v2 = summarise(GT, ENTRIES, v2Results, { ...meta, generatedAt: new Date("2026-10-21T13:00:00Z"), claimsVersion: 2 });

  it("records claims_version; Phase 10 files without the field read as v1", () => {
    expect(v1.claims_version).toBe(1);
    expect(v2.claims_version).toBe(2);
    expect(summarise(GT, ENTRIES, RESULTS, meta).claims_version).toBeUndefined();
  });

  it("renders both AUCs, the claims-axis AUC, both Spearman values and the insufficient_data count side by side", () => {
    const md = renderResultsMd([
      { file: "results-2026-10-21-offline-v1.json", results: v1 },
      { file: "results-2026-10-21-offline-v2.json", results: v2 },
    ]);
    expect(md).toContain("## Claims formula v1 vs v2 (Phase 14, ADR-030)");
    expect(md).toContain("### Claims formula v1 vs v2 (offline)");
    expect(md).toContain(`| AUC overall | ${v1.stats.auc!.toFixed(2)} | ${v2.stats.auc!.toFixed(2)} |`);
    expect(md).toContain(`| AUC claims axis (scored axes only) | ${v1.stats.per_axis.claims.auc!.toFixed(2)} (2/1) | ${v2.stats.per_axis.claims.auc!.toFixed(2)} (1/1) |`);
    expect(md).toContain(`| Spearman claim matches vs score | ${v1.stats.spearman_claims_score!.toFixed(2)} | ${v2.stats.spearman_claims_score!.toFixed(2)} |`);
    expect(md).toContain("| Spearman words scanned vs score |");
    expect(md).toContain("| Claims axis insufficient_data | 0 of 3 | 1 of 3 |");
    // Hand values: v1 scores a=50, c=20 vs d=30 ⇒ AUC 0.5; v2 a=10, c=20 vs d=30 ⇒ 0.
    expect(v1.stats.auc).toBe(0.5);
    expect(v2.stats.auc).toBe(0);
    expect(md).toMatch(/\| 2026-10-21 \| offline \| `abc1234` \| 1 \| v2 \|/);
  });

  it("is omitted when only one version was run", () => {
    expect(renderClaimsComparison([{ file: "x.json", results: v1 }])).toEqual([]);
    expect(renderResultsMd([{ file: "x.json", results: v1 }])).not.toContain("Claims formula v1 vs v2");
  });
});
