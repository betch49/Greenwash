// The plain-English summary (PLAN Phase 7 deliverable 5; brief Section 1: the
// LLM must never invent a source). The model gets the scored report and the
// list of URLs the pipeline fetched. The summary is rejected, and the UI shows
// "Summary unavailable", when it cites any URL outside that list, uses a
// forbidden word (ADR-008), or is longer than summary.maxWords words. The
// summary is text only: nothing in it feeds the score.

import { z } from "zod";
import { findForbidden } from "../copy/forbidden";
import type { ReportV1 } from "../score/report";
import type { LLMCallLog, LLMClient } from "./client";
import { LLM_CONFIG, type LlmConfig } from "./config";
import { urlsIn, validateObject, wordCount } from "./validate";

export const SummaryOutputSchema = z.strictObject({
  summary: z.string().min(1),
  cited_urls: z.array(z.string()),
});

export type SummaryOutput = z.infer<typeof SummaryOutputSchema>;

/** At most this many receipts per axis are passed to the model (they are ordered as in the report). */
const SIGNALS_PER_AXIS = 12;

export const summaryInstructions = (maxWords: number) =>
  [
    `Task: write a plain-English summary of this report for a shopper, in at most ${maxWords} words.`,
    "Say what the risk signals are and where they come from; mention what could not be checked if it matters. Use the wording “risk signals”, “unsupported claim”, “claim removed between X and Y”.",
    "Do not restate the score as your own judgement and do not add any figure that is not in the input.",
    "If you mention a source, use only a URL from input.allowed_urls, exactly as written, and list every URL you mention in cited_urls. Never cite any other URL.",
  ].join("\n");

export interface SummaryInput {
  brand: string;
  website: string;
  score: number;
  label: string;
  confidence: number;
  ai_share: number;
  basis: string;
  axes: { id: string; status: string; subscore: number; signals: { label: string; excerpt: string; source_url: string; snapshot_date?: string; entity_name?: string }[] }[];
  removals: { page_url: string; from: number; to: string; sentence: string }[];
  could_not_check: string[];
  allowed_urls: string[];
}

/** Every URL the pipeline fetched and the report can point at: pages, signal receipts, archived copies. */
export function allowedUrls(report: Pick<ReportV1, "axes" | "timeline">, pageUrls: string[]): string[] {
  const set = new Set<string>(pageUrls);
  for (const a of report.axes) for (const s of a.signals) set.add(s.source_url);
  for (const t of report.timeline) set.add(t.snapshot_url);
  return [...set].sort();
}

/**
 * The exact input sent (also the fixture key). Run-specific values (run id,
 * generation time, fetch times) are left out so the same report hashes the same.
 */
export function summaryInput(report: ReportV1, pageUrls: string[]): SummaryInput {
  return {
    brand: report.brand,
    website: report.website,
    score: report.score,
    label: report.label_text,
    confidence: report.confidence,
    ai_share: report.ai_share,
    basis: report.basis,
    axes: report.axes.map((a) => ({
      id: a.id,
      status: a.status,
      subscore: a.subscore,
      signals: a.signals.slice(0, SIGNALS_PER_AXIS).map((s) => ({
        label: s.label,
        excerpt: s.excerpt,
        source_url: s.source_url,
        ...(s.snapshot_date ? { snapshot_date: s.snapshot_date } : {}),
        ...(s.entity_name ? { entity_name: s.entity_name } : {}),
      })),
    })),
    removals: report.timeline.flatMap((t) =>
      t.claims_removed.map((sentence) => ({ page_url: t.page_url, from: t.previous_year ?? t.year, to: t.live ? "the current page" : String(t.year), sentence })),
    ),
    could_not_check: report.could_not_check,
    allowed_urls: allowedUrls(report, pageUrls),
  };
}

export type SummaryCheck = { ok: true; value: SummaryOutput } | { ok: false; reason: string };

/** The acceptance rule for a summary (pure; 7.4). */
export function checkSummary(output: unknown, allowed: string[], config: LlmConfig = LLM_CONFIG): SummaryCheck {
  const v = validateObject(output, SummaryOutputSchema);
  if (!v.ok) return { ok: false, reason: `invalid output (${v.reason})` };
  const { summary, cited_urls } = v.value;
  const allow = new Set(allowed);
  const foreign = [...urlsIn(summary), ...cited_urls].filter((u) => !allow.has(u));
  if (foreign.length > 0) return { ok: false, reason: `cites a URL that was not fetched (${foreign[0]})` };
  const words = wordCount(summary);
  if (words > config.summary.maxWords) return { ok: false, reason: `longer than ${config.summary.maxWords} words (${words})` };
  const bad = findForbidden(summary);
  if (bad.length > 0) return { ok: false, reason: `fails the wording filter (“${bad[0].term}”)` };
  return { ok: true, value: { summary: summary.trim(), cited_urls } };
}

export interface SummaryOutcome {
  summary?: { text: string; cited_urls: string[] };
  log: LLMCallLog;
  problem?: string;
}

/** Calls the LLM for the report summary. Never throws; a rejected summary is a `problem`. */
export async function summarise(llm: LLMClient, report: ReportV1, pageUrls: string[], config: LlmConfig = LLM_CONFIG): Promise<SummaryOutcome> {
  const input = summaryInput(report, pageUrls);
  let res;
  try {
    res = await llm.call({ name: "summary", instructions: summaryInstructions(config.summary.maxWords), input, schema: SummaryOutputSchema });
  } catch (err) {
    return { problem: err instanceof Error ? err.message : String(err), log: { name: "summary", used_fixture: false, status: "error" } };
  }
  if (res.output === undefined) return { log: { name: "summary", used_fixture: res.used_fixture, status: "empty" } };
  const check = checkSummary(res.output, input.allowed_urls, config);
  if (!check.ok) return { problem: check.reason, log: { name: "summary", used_fixture: res.used_fixture, status: "invalid" } };
  return { summary: { text: check.value.summary, cited_urls: check.value.cited_urls }, log: { name: "summary", used_fixture: res.used_fixture, status: "ok" } };
}
