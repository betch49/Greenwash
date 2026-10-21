// Validation results (PLAN Phase 10 deliverable 2): the dated results JSON and
// docs/validation/RESULTS.md, regenerated from every results file in the
// directory so earlier figures (Phase 10 baseline, later phases) stay visible.
// Evaluation only: nothing here is read by the pipeline or the scorer.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { BrandResult, Mode } from "./harness";
import { FLAG_SOURCES, type CitationSource, type Entry, type GroundTruth } from "./ground-truth";
import { auc, mean, meanDifference, median, medianDifference, spearman } from "./stats";

/**
 * Ground-truth sources that the pipeline itself also queries. A flagged entry whose
 * flags all come from these sources is partly "the pipeline agreeing with itself":
 * RESULTS.md reports how many there are (the leakage line, criterion 10.6).
 * Phase 11 adds "sbti", Phase 13 adds "sabin" when their adapters ship.
 */
export const PIPELINE_SOURCES: readonly CitationSource[] = ["asa", "jdp"];

/** Below this many reports per group, the separation figure is indicative only (PLAN Phase 10 deliverable 5). */
export const MIN_PER_GROUP = 5;

const AXIS_IDS = ["claims", "evidence", "track", "repair"] as const;
const num = z.number().nullable();

const BrandResultSchema = z.object({
  slug: z.string(),
  name: z.string(),
  group: z.enum(["flagged", "well_rated", "contested"]),
  status: z.enum(["ran", "failed", "not_run"]),
  reason: z.string().optional(),
  resolution: z.enum(["fixture", "wikidata", "website"]).optional(),
  brand: z.string().optional(),
  website: z.string().optional(),
  wikidata_id: z.string().optional(),
  score: z.number().optional(),
  label: z.string().optional(),
  confidence: z.number().optional(),
  ai_share: z.number().optional(),
  axes: z.array(z.object({ id: z.string(), status: z.string(), subscore: z.number() })).optional(),
  pages: z.number(),
  words_scanned: z.number(),
  claim_matches: z.number(),
  signals_count: z.number().optional(),
  steps: z.array(z.object({ step: z.string(), status: z.string(), reason: z.string().optional() })),
  steps_done: z.number(),
  steps_skipped: z.number(),
  duration_ms: z.number(),
});

export const ResultsSchema = z.object({
  version: z.literal(1),
  label_use: z.literal("evaluation_only"),
  mode: z.enum(["offline", "live"]),
  generated_at: z.string(),
  commit: z.string(),
  commit_dirty: z.boolean(),
  weights_version: z.number(),
  /** Phase 14: the claims formula the run was scored with (claimsRate.version); absent in Phase 10 files (= 1). */
  claims_version: z.number().optional(),
  llm: z.string(),
  /** Labelled entries selected for this run (after --brands). */
  n_selected: z.number(),
  n_flagged: z.number(),
  n_well_rated: z.number(),
  n_contested: z.number(),
  n_ran: z.number(),
  n_failed: z.number(),
  n_not_run: z.number(),
  /** Reports in the separation sample per group. */
  n_flagged_ran: z.number(),
  n_well_rated_ran: z.number(),
  partial: z.string().nullable(),
  stats: z.object({
    auc: num,
    mean_flagged: num,
    mean_well_rated: num,
    mean_difference: num,
    median_flagged: num,
    median_well_rated: num,
    median_difference: num,
    per_axis: z.record(z.string(), z.object({ auc: num, n_flagged: z.number(), n_well_rated: z.number() })),
    spearman_words_score: num,
    spearman_claims_score: num,
    n_spearman: z.number(),
  }),
  leakage: z.object({
    pipeline_sources: z.array(z.string()),
    flagged_total: z.number(),
    flagged_only_pipeline_sources: z.number(),
    flagged_ran: z.number(),
    flagged_ran_only_pipeline_sources: z.number(),
  }),
  notes: z.array(z.string()),
  brands: z.array(BrandResultSchema),
});

export type Results = z.infer<typeof ResultsSchema>;

export interface ResultsMeta {
  mode: Mode;
  generatedAt: Date;
  commit: string;
  commitDirty: boolean;
  weightsVersion: number;
  claimsVersion?: number;
  llm: string;
  notes?: string[];
}

/** True when every flag citation of the entry comes from a source the pipeline also queries. */
export function flaggedOnlyByPipeline(entry: Entry, pipelineSources: readonly CitationSource[] = PIPELINE_SOURCES): boolean {
  const flags = entry.citations.filter((c) => c.role === "flag" && FLAG_SOURCES.includes(c.source));
  return flags.length > 0 && flags.every((c) => pipelineSources.includes(c.source));
}

export function leakage(entries: readonly Entry[], results: readonly BrandResult[], pipelineSources: readonly CitationSource[] = PIPELINE_SOURCES): Results["leakage"] {
  const flagged = entries.filter((e) => e.group === "flagged");
  const ran = new Set(results.filter((r) => r.status === "ran").map((r) => r.slug));
  const only = flagged.filter((e) => flaggedOnlyByPipeline(e, pipelineSources));
  return {
    pipeline_sources: [...pipelineSources],
    flagged_total: flagged.length,
    flagged_only_pipeline_sources: only.length,
    flagged_ran: flagged.filter((e) => ran.has(e.slug)).length,
    flagged_ran_only_pipeline_sources: only.filter((e) => ran.has(e.slug)).length,
  };
}

/** Builds the results document from the harness output (pure; no I/O). */
export function summarise(gt: GroundTruth, selected: readonly Entry[], results: readonly BrandResult[], meta: ResultsMeta): Results {
  const ran = results.filter((r) => r.status === "ran");
  const f = ran.filter((r) => r.group === "flagged");
  const w = ran.filter((r) => r.group === "well_rated");
  const scores = (rs: BrandResult[]) => rs.map((r) => r.score!);
  const perAxis: Results["stats"]["per_axis"] = {};
  for (const axis of AXIS_IDS) {
    const sub = (rs: BrandResult[]) => rs.flatMap((r) => r.axes?.filter((a) => a.id === axis && a.status === "scored").map((a) => a.subscore) ?? []);
    const fa = sub(f);
    const wa = sub(w);
    perAxis[axis] = { auc: auc(fa, wa), n_flagged: fa.length, n_well_rated: wa.length };
  }
  const labelled = [...f, ...w];
  const nRan = ran.length;
  const nSelected = selected.length;
  const notes = [...(meta.notes ?? [])];
  if (f.length < MIN_PER_GROUP || w.length < MIN_PER_GROUP) {
    notes.push(
      meta.mode === "live"
        ? `Fewer than ${MIN_PER_GROUP} reports in a group (flagged ${f.length}, well-rated ${w.length}): this live run gives no separation figure of its own; the offline result stands as the only separation figure.`
        : `Fewer than ${MIN_PER_GROUP} reports in a group (flagged ${f.length}, well-rated ${w.length}): the separation figure is indicative only.`,
    );
  }
  return ResultsSchema.parse({
    version: 1,
    label_use: "evaluation_only",
    mode: meta.mode,
    generated_at: meta.generatedAt.toISOString(),
    commit: meta.commit,
    commit_dirty: meta.commitDirty,
    weights_version: meta.weightsVersion,
    ...(meta.claimsVersion !== undefined ? { claims_version: meta.claimsVersion } : {}),
    llm: meta.llm,
    n_selected: nSelected,
    n_flagged: selected.filter((e) => e.group === "flagged").length,
    n_well_rated: selected.filter((e) => e.group === "well_rated").length,
    n_contested: selected.filter((e) => e.group === "contested").length,
    n_ran: nRan,
    n_failed: results.filter((r) => r.status === "failed").length,
    n_not_run: results.filter((r) => r.status === "not_run").length,
    n_flagged_ran: f.length,
    n_well_rated_ran: w.length,
    partial: nRan < nSelected ? partialSentence(nRan, nSelected) : null,
    stats: {
      auc: auc(scores(f), scores(w)),
      mean_flagged: mean(scores(f)),
      mean_well_rated: mean(scores(w)),
      mean_difference: meanDifference(scores(f), scores(w)),
      median_flagged: median(scores(f)),
      median_well_rated: median(scores(w)),
      median_difference: medianDifference(scores(f), scores(w)),
      per_axis: perAxis,
      spearman_words_score: spearman(labelled.map((r) => r.words_scanned), scores(labelled)),
      spearman_claims_score: spearman(labelled.map((r) => r.claim_matches), scores(labelled)),
      n_spearman: labelled.length,
    },
    leakage: leakage(gt.entries.filter((e) => selected.some((s) => s.slug === e.slug)), results),
    notes,
    brands: results,
  });
}

export const partialSentence = (n: number, m: number) => `Partial run: ${n} of ${m} brands produced a report.`;

export const resultsFileName = (r: Pick<Results, "generated_at" | "mode">, tag?: string) => `results-${r.generated_at.slice(0, 10)}-${r.mode}${tag ? `-${tag}` : ""}.json`;

const fmt = (x: number | null | undefined, digits = 2) => (x === null || x === undefined ? "n/a" : x.toFixed(digits));

export const aucLine = (r: Results) =>
  `AUC (flagged vs well-rated, overall score): ${fmt(r.stats.auc)} (n flagged = ${r.n_flagged_ran}, n well-rated = ${r.n_well_rated_ran})`;

export const leakageLine = (r: Results) =>
  `Leakage: ${r.leakage.flagged_only_pipeline_sources} of ${r.leakage.flagged_total} flagged entries are flagged only by sources the pipeline itself queries (${r.leakage.pipeline_sources.map((s) => s.toUpperCase()).join(", ")}); ${r.leakage.flagged_ran_only_pipeline_sources} of the ${r.leakage.flagged_ran} flagged brands in this run.`;

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The detailed section for one results file. */
export function renderRun(r: Results, file: string): string {
  const lines: string[] = [];
  lines.push(`### ${r.mode === "live" ? "Live" : "Offline"} run, ${r.generated_at.slice(0, 10)} (\`${file}\`)`, "");
  lines.push(`Commit \`${r.commit}\`${r.commit_dirty ? " (uncommitted changes present)" : ""}, weights version ${r.weights_version}, claims formula v${claimsVersionOf(r)}, LLM: ${r.llm}.`, "");
  if (r.partial) lines.push(`**${r.partial}**`, "");
  lines.push(`- ${aucLine(r)}`);
  lines.push(`- Mean score: flagged ${fmt(r.stats.mean_flagged, 1)}, well-rated ${fmt(r.stats.mean_well_rated, 1)}; difference ${fmt(r.stats.mean_difference, 1)}. Median difference ${fmt(r.stats.median_difference, 1)}.`);
  lines.push(
    `- Per-axis AUC (scored axes only): ${AXIS_IDS.map((a) => {
      const p = r.stats.per_axis[a];
      return `${a} ${fmt(p?.auc)} (${p?.n_flagged ?? 0}/${p?.n_well_rated ?? 0})`;
    }).join("; ")}.`,
  );
  lines.push(
    `- "Saying less scores better" diagnostic (Spearman, n = ${r.stats.n_spearman}): words scanned vs score ${fmt(r.stats.spearman_words_score)}; claim-rule matches vs score ${fmt(r.stats.spearman_claims_score)}.`,
  );
  lines.push(`- ${leakageLine(r)}`);
  lines.push(`- Entries: ${r.n_flagged} flagged, ${r.n_well_rated} well-rated, ${r.n_contested} contested (contested are run when possible but never in the statistics). Ran ${r.n_ran}, failed ${r.n_failed}, not run ${r.n_not_run}.`);
  for (const n of r.notes) lines.push(`- ${n}`);
  lines.push("", "| Brand | Group | Status | Score | Confidence | Pages | Words | Claim matches | Steps done / skipped | Reason or skipped steps |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const b of r.brands) {
    const skipped = b.steps.filter((s) => s.status === "skipped").map((s) => `${s.step}: ${s.reason ?? ""}`);
    const why = [b.reason, ...skipped].filter(Boolean).join("; ");
    lines.push(
      `| ${esc(b.name)} | ${b.group} | ${b.status} | ${b.score ?? "–"} | ${b.confidence ?? "–"} | ${b.pages} | ${b.words_scanned} | ${b.claim_matches} | ${b.steps_done} / ${b.steps_skipped} | ${esc(why.length > 400 ? `${why.slice(0, 399)}…` : why) || "–"} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** The claims formula of a results file (Phase 10 files predate the field: v1). */
export const claimsVersionOf = (r: Pick<Results, "claims_version">) => r.claims_version ?? 1;

/** The claims-axis status that formula v2 gives below `minClaims` sentences. */
const INSUFFICIENT = "insufficient_data";

/**
 * Phase 14 (criterion 14.5): "Claims formula v1 vs v2" — for each mode, the latest run
 * with each formula version, side by side: overall AUC, claims-axis AUC, the Spearman
 * diagnostic, and how many brands the claims axis was not scored for. Rendered only
 * when at least one run of each version exists for a mode.
 */
export function renderClaimsComparison(files: { file: string; results: Results }[]): string[] {
  const sorted = [...files].sort((a, b) => a.results.generated_at.localeCompare(b.results.generated_at));
  const out: string[] = [];
  for (const mode of ["offline", "live"] as const) {
    const v1 = sorted.filter((x) => x.results.mode === mode && claimsVersionOf(x.results) === 1).at(-1);
    const v2 = sorted.filter((x) => x.results.mode === mode && claimsVersionOf(x.results) === 2).at(-1);
    if (!v1 || !v2) continue;
    const row = (label: string, f: (r: Results) => string) => `| ${label} | ${f(v1.results)} | ${f(v2.results)} |`;
    const insufficient = (r: Results) => r.brands.filter((b) => b.status === "ran" && b.axes?.some((a) => a.id === "claims" && a.status === INSUFFICIENT)).length;
    out.push(`### Claims formula v1 vs v2 (${mode})`, "");
    out.push(`v1 = risky-phrase density per 1,000 words; v2 = share of unsupported claim sentences, "${INSUFFICIENT}" below the configured minimum (ADR-030). Same harness, same brands; the active formula is \`claimsRate.version\` in \`config/weights.json\`.`, "");
    out.push("| Measure | v1 | v2 |", "|---|---|---|");
    out.push(row("File", (r) => `\`${r === v1.results ? v1.file : v2.file}\``));
    out.push(row("Commit", (r) => `\`${r.commit}\``));
    out.push(row("Reports (flagged / well-rated)", (r) => `${r.n_flagged_ran} / ${r.n_well_rated_ran}`));
    out.push(row("AUC overall", (r) => fmt(r.stats.auc)));
    out.push(row("AUC claims axis (scored axes only)", (r) => `${fmt(r.stats.per_axis.claims?.auc)} (${r.stats.per_axis.claims?.n_flagged ?? 0}/${r.stats.per_axis.claims?.n_well_rated ?? 0})`));
    out.push(row("Spearman words scanned vs score", (r) => fmt(r.stats.spearman_words_score)));
    out.push(row("Spearman claim matches vs score", (r) => fmt(r.stats.spearman_claims_score)));
    out.push(row("Mean difference (flagged − well-rated)", (r) => fmt(r.stats.mean_difference, 1)));
    out.push(row(`Claims axis ${INSUFFICIENT}`, (r) => `${insufficient(r)} of ${r.n_ran}`));
    out.push("");
  }
  return out;
}

/** RESULTS.md from every results file: a history table, then the latest offline and live runs in detail. */
export function renderResultsMd(files: { file: string; results: Results }[]): string {
  const sorted = [...files].sort((a, b) => a.results.generated_at.localeCompare(b.results.generated_at));
  const out: string[] = [
    "# Validation results",
    "",
    "Generated by `npm run validate` (`scripts/validate.ts`); do not edit by hand. Ground truth: `fixtures/validation/ground-truth.json` (method: `docs/METHODOLOGY.md` Section 13, `docs/SOURCES.md`).",
    "Ground-truth labels are used for evaluation only and never enter the score. AUC is the probability that a flagged brand scores higher than a well-rated one (ties count one half): 1 = perfect separation, 0.5 = none.",
    "",
    "## History",
    "",
    "| Date | Mode | Commit | Weights | Claims formula | Flagged ran | Well-rated ran | Ran / selected | AUC | Mean difference | Spearman words–score | File |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const { file, results: r } of sorted) {
    out.push(
      `| ${r.generated_at.slice(0, 10)} | ${r.mode} | \`${r.commit}\` | ${r.weights_version} | v${claimsVersionOf(r)} | ${r.n_flagged_ran} | ${r.n_well_rated_ran} | ${r.n_ran} / ${r.n_selected} | ${fmt(r.stats.auc)} | ${fmt(r.stats.mean_difference, 1)} | ${fmt(r.stats.spearman_words_score)} | \`${file}\` |`,
    );
  }
  out.push("");
  const comparison = renderClaimsComparison(sorted);
  if (comparison.length) out.push("## Claims formula v1 vs v2 (Phase 14, ADR-030)", "", ...comparison);
  for (const mode of ["offline", "live"] as const) {
    const latest = sorted.filter((x) => x.results.mode === mode).at(-1);
    out.push(`## Latest ${mode} run`, "");
    out.push(latest ? renderRun(latest.results, latest.file) : `No ${mode} run recorded yet.\n`);
  }
  return out.join("\n");
}

/** Reads every results-*.json in `dir` (invalid files are skipped with a warning line). */
export function readResultsDir(dir: string): { file: string; results: Results }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^results-.*\.json$/.test(f))
    .flatMap((file) => {
      const parsed = ResultsSchema.safeParse(JSON.parse(readFileSync(join(dir, file), "utf8")));
      return parsed.success ? [{ file, results: parsed.data }] : [];
    });
}

/** Writes the results file and regenerates RESULTS.md. Returns both paths. */
export function writeResults(dir: string, results: Results, tag?: string): { json: string; md: string } {
  mkdirSync(dir, { recursive: true });
  const file = resultsFileName(results, tag);
  const json = join(dir, file);
  writeFileSync(json, `${JSON.stringify(ResultsSchema.parse(results), null, 2)}\n`);
  const md = join(dir, "RESULTS.md");
  writeFileSync(md, renderResultsMd(readResultsDir(dir)));
  return { json, md };
}
