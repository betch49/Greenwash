// Validation harness (PLAN Phase 10 deliverable 2): runs the real pipeline for
// each ground-truth brand through the app's own run path (`launchRun`, the
// function behind the "Analyse" button) with injected services, and collects
// the scored report, step statuses and skipped reasons.
//
// EVALUATION ONLY: the group label of an entry is copied into the result for
// the statistics and is never passed to the pipeline (it only receives the
// brand name, website and Wikidata entity, exactly as from the confirm screen).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { launchRun, type RunServices } from "../pipeline/start";
import type { PipelineOutcome } from "../pipeline/run";
import type { ReportV1 } from "../score/report";
import { disambiguate } from "../wikidata/disambiguate";
import type { Candidate } from "../wikidata/rank";
import type { Entry, Group } from "./ground-truth";

export type Mode = "offline" | "live";

export interface StepLine {
  step: string;
  status: "running" | "done" | "skipped";
  reason?: string;
}

export interface BrandResult {
  slug: string;
  name: string;
  group: Group;
  /** ran = a report with at least one fetched page; failed = no report, or no page could be fetched; not_run = not selected for this mode. */
  status: "ran" | "failed" | "not_run";
  reason?: string;
  /** How the brand was entered: recorded fixture entity, live Wikidata match, or the website alone (URL fallback). */
  resolution?: "fixture" | "wikidata" | "website";
  brand?: string;
  website?: string;
  wikidata_id?: string;
  score?: number;
  label?: string;
  confidence?: number;
  ai_share?: number;
  axes?: { id: string; status: string; subscore: number }[];
  pages: number;
  words_scanned: number;
  /** Claim-rule matches over all fetched pages (the claim-sentence count of the Spearman diagnostic). */
  claim_matches: number;
  signals_count?: number;
  steps: StepLine[];
  steps_done: number;
  steps_skipped: number;
  duration_ms: number;
}

export interface Resolved {
  brand: string;
  website: string;
  wikidataId?: string;
  entity?: unknown;
  resolution: NonNullable<BrandResult["resolution"]>;
  note?: string;
}

export interface HarnessOptions {
  mode: Mode;
  services: RunServices;
  /** Root of the fixtures (offline mode reads fixtures/brands/<fixture>/meta.json). */
  fixturesRoot?: string;
  /** Overrides how an entry becomes a run (tests). */
  resolve?: (entry: Entry) => Promise<Resolved>;
  log?: (line: string) => void;
}

interface FixtureMeta {
  website: string;
  query?: string;
  entity?: (Partial<Candidate> & { id?: string | null; name?: string }) | null;
}

/** Whether an entry can run offline: it names a brand fixture that exists. */
export function hasFixture(entry: Entry, root = "fixtures"): boolean {
  return !!entry.fixture && existsSync(join(root, "brands", entry.fixture, "meta.json"));
}

/** Offline: the recorded fixture entity, exactly what the confirm screen would pass. */
export function resolveFromFixture(entry: Entry, root = "fixtures"): Resolved {
  const meta = JSON.parse(readFileSync(join(root, "brands", entry.fixture!, "meta.json"), "utf8")) as FixtureMeta;
  const ent = meta.entity;
  if (ent?.id && ent.name) return { brand: ent.name, website: meta.website, wikidataId: ent.id, entity: ent, resolution: "fixture" };
  return { brand: entry.name, website: meta.website, resolution: "website" };
}

/**
 * Live: the app's Wikidata disambiguation for the entry's query. The candidate
 * with the entry's Wikidata id wins, else the confident match; a candidate
 * without a website, no match, or Wikidata failing ⇒ the URL fallback with the
 * entry's website (what a user pasting the website gets).
 */
export async function resolveLive(entry: Entry, services: Pick<RunServices, "fetcher">): Promise<Resolved> {
  try {
    const r = await disambiguate(services.fetcher, entry.query ?? entry.name);
    const c = (entry.wikidata_id && r.candidates.find((x) => x.id === entry.wikidata_id)) || r.confident;
    if (c?.website) return { brand: c.name, website: c.website, wikidataId: c.id, entity: c, resolution: "wikidata" };
    return { brand: entry.name, website: entry.website, resolution: "website", note: "no Wikidata candidate with a website; URL fallback" };
  } catch (err) {
    return { brand: entry.name, website: entry.website, resolution: "website", note: `Wikidata unavailable (${messageOf(err)}); URL fallback` };
  }
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

const empty = (entry: Entry, status: BrandResult["status"], reason: string): BrandResult => ({
  slug: entry.slug,
  name: entry.name,
  group: entry.group,
  status,
  reason,
  pages: 0,
  words_scanned: 0,
  claim_matches: 0,
  steps: [],
  steps_done: 0,
  steps_skipped: 0,
  duration_ms: 0,
});

/** The first skipped reason of the page-fetch steps, for a run that fetched nothing. */
function noPageReason(progress: StepLine[]): string {
  const s = progress.find((p) => p.status === "skipped" && /fetch|discover|pages/i.test(p.step) && p.reason);
  return s?.reason ? `no page could be fetched (${s.reason})` : "no page could be fetched";
}

/** Runs one brand. Never throws: any error becomes a `failed` result with the reason. */
export async function runBrand(entry: Entry, opts: HarnessOptions): Promise<BrandResult> {
  const t0 = Date.now();
  const root = opts.fixturesRoot ?? "fixtures";
  try {
    const resolved = opts.resolve ? await opts.resolve(entry) : opts.mode === "offline" ? resolveFromFixture(entry, root) : await resolveLive(entry, opts.services);
    const run = opts.services.runs.create({
      query: entry.query ?? entry.name,
      brand: resolved.brand,
      website: resolved.website,
      wikidataId: resolved.wikidataId ?? null,
      ...(resolved.entity ? { entity: resolved.entity } : {}),
    });
    const started = launchRun(opts.services, run);
    if (!started) throw new Error("run could not be started");
    const outcome: PipelineOutcome = await started;
    const steps: StepLine[] = outcome.progress.map((p) => ({ step: p.step, status: p.status, ...(p.reason ? { reason: p.reason } : {}) }));
    const words = outcome.pages.reduce((n, p) => n + p.wordCount, 0);
    const base: BrandResult = {
      ...empty(entry, "ran", ""),
      resolution: resolved.resolution,
      brand: resolved.brand,
      website: resolved.website,
      ...(resolved.wikidataId ? { wikidata_id: resolved.wikidataId } : {}),
      pages: outcome.pages.length,
      words_scanned: words,
      claim_matches: outcome.claim_stats?.matches ?? 0,
      steps,
      steps_done: steps.filter((s) => s.status === "done").length,
      steps_skipped: steps.filter((s) => s.status === "skipped").length,
      duration_ms: Date.now() - t0,
    };
    delete base.reason;
    if (resolved.note) base.reason = resolved.note;
    const report: ReportV1 | undefined = outcome.report;
    if (outcome.status !== "done" || !report) {
      const last = [...steps].reverse().find((s) => s.status === "skipped");
      return { ...base, status: "failed", reason: `run failed${last?.reason ? `: ${last.reason}` : ""}` };
    }
    const withReport: BrandResult = {
      ...base,
      score: report.score,
      label: report.label,
      confidence: report.confidence,
      ai_share: report.ai_share,
      axes: report.axes.map((a) => ({ id: a.id, status: a.status, subscore: a.subscore })),
      signals_count: report.signals_count,
    };
    // A report built on zero fetched pages says nothing about the brand's claims: it is
    // counted as failed (with the reason) and kept out of the separation sample.
    if (outcome.pages.length === 0) return { ...withReport, status: "failed", reason: noPageReason(steps) };
    return withReport;
  } catch (err) {
    return { ...empty(entry, "failed", messageOf(err)), duration_ms: Date.now() - t0 };
  }
}

/**
 * Runs every entry in order and continues past failures. Offline, an entry
 * without a brand fixture is `not_run` (it has no recorded pages).
 */
export async function runHarness(entries: readonly Entry[], opts: HarnessOptions): Promise<BrandResult[]> {
  const out: BrandResult[] = [];
  const root = opts.fixturesRoot ?? "fixtures";
  for (const entry of entries) {
    if (opts.mode === "offline" && !opts.resolve && !hasFixture(entry, root)) {
      out.push(empty(entry, "not_run", "no offline fixture"));
      continue;
    }
    opts.log?.(`running ${entry.slug} (${opts.mode})…`);
    const r = await runBrand(entry, opts);
    opts.log?.(`  ${entry.slug}: ${r.status}${r.score !== undefined ? ` score ${r.score}` : ""}${r.reason ? ` (${r.reason})` : ""} in ${Math.round(r.duration_ms / 1000)} s`);
    out.push(r);
  }
  return out;
}
