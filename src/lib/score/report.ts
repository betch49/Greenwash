// ReportV1 (PLAN Phase 6 deliverable 6): the stored, exported report model.
import { z } from "zod";
import type { PipelineOutcome } from "../pipeline/run";
import { couldNotCheck } from "../copy/wording";
import { score, type ScoreOptions } from "./scorer";
import { AXES, WEIGHTS } from "./weights";

const SignalSchema = z.object({
  id: z.string().min(1),
  axis: z.enum(AXES),
  kind: z.string().min(1),
  label: z.string().min(1),
  weight_hint: z.number(),
  source_url: z.string().url(),
  fetched_at: z.string().min(1),
  excerpt: z.string().min(1),
  snapshot_date: z.string().optional(),
  entity_name: z.string().optional(),
  llm_used: z.boolean(),
});

const TimelineEntrySchema = z.object({
  year: z.number().int(),
  snapshot_url: z.string(),
  claims_present: z.array(z.string()),
  claims_removed: z.array(z.string()),
  page_url: z.string(),
  snapshot_date: z.string(),
  previous_year: z.number().int().optional(),
  live: z.boolean().optional(),
});

/** One logged LLM call (brief Section 4: log which sub-signals depended on an LLM call). */
const LlmCallSchema = z.object({
  name: z.enum(["extract", "classify-diff", "summary"]),
  used_fixture: z.boolean(),
  status: z.enum(["ok", "empty", "invalid", "error"]),
});

export const ReportV1Schema = z.object({
  version: z.literal(1),
  run_id: z.string().min(1),
  brand: z.string().min(1),
  website: z.string().min(1),
  score: z.number().int().min(0).max(100),
  label: z.enum(["low", "moderate", "high"]),
  label_text: z.string().min(1),
  confidence: z.number().int().min(0).max(100),
  ai_share: z.number().min(0).max(1),
  llm_signal_ids: z.array(z.string()),
  basis: z.string().min(1),
  axes: z
    .array(
      z.object({
        id: z.enum(AXES),
        weight: z.number().min(0).max(1),
        effective_weight: z.number().min(0).max(1),
        status: z.enum(["scored", "missing", "not_applicable", "insufficient_data"]),
        subscore: z.number().min(0).max(100),
        signals: z.array(SignalSchema),
      }),
    )
    .length(AXES.length),
  timeline: z.array(TimelineEntrySchema),
  could_not_check: z.array(z.string()),
  skipped: z.array(z.object({ step: z.string(), reason: z.string() })),
  generated_at: z.string().min(1),
  sources_count: z.number().int().min(0),
  signals_count: z.number().int().min(0),
  /** Phase 7: the plain-English summary; absent ⇒ "Summary unavailable". Text only, never scored. */
  summary: z.object({ text: z.string().min(1), cited_urls: z.array(z.string().url()) }).optional(),
  /** Phase 7: every LLM call of the run. */
  llm_calls: z.array(LlmCallSchema).default([]),
});

export type ReportV1 = z.infer<typeof ReportV1Schema>;

export interface ReportRun {
  id: string;
  brand: string;
  website: string;
}

/** Builds and validates the report of a finished pipeline run. */
export function buildReport(run: ReportRun, outcome: Pick<PipelineOutcome, "signals" | "pages" | "claim_stats" | "repair_axis" | "step_status" | "timeline" | "could_not_check" | "progress">, generatedAt: Date, opts: ScoreOptions = {}): ReportV1 {
  const result = score(
    {
      signals: outcome.signals,
      words_scanned: outcome.pages.reduce((n, p) => n + p.wordCount, 0),
      repair_axis: outcome.repair_axis,
      step_status: outcome.step_status,
      // Archived copies only: the live page row of the timeline (ADR-017) is not an archived snapshot.
      archived_snapshots: outcome.timeline.filter((t) => !t.live).length,
      claim_stats: outcome.claim_stats,
    },
    opts,
  );
  return ReportV1Schema.parse({
    version: 1,
    run_id: run.id,
    brand: run.brand,
    website: run.website,
    score: result.score,
    label: result.label,
    label_text: result.label_text,
    confidence: result.confidence,
    ai_share: result.ai_share,
    llm_signal_ids: result.llm_signal_ids,
    basis: result.basis,
    axes: result.axes,
    timeline: outcome.timeline,
    // Phase 14: an insufficient-data claims axis says so in "What we could not check".
    could_not_check: result.axes.some((a) => a.id === "claims" && a.status === "insufficient_data")
      ? [...outcome.could_not_check, couldNotCheck.claimsInsufficient((opts.weights ?? WEIGHTS).claimsRate.v2.minClaims)]
      : outcome.could_not_check,
    skipped: outcome.progress.filter((p) => p.status === "skipped").map((p) => ({ step: p.step, reason: p.reason ?? "" })),
    generated_at: generatedAt.toISOString(),
    sources_count: result.sources_count,
    signals_count: result.signals_count,
  });
}
