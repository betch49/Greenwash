// Display-only helpers for the report and analyse pages (QA fix round). Nothing
// here changes a number in the score: the stored report keeps every number; the
// UI hides the score and label when there is too little evidence to show them,
// and the JSON export adds `display_status`.
import reportConfig from "../../../config/report.json";
import { reportWording, scoreWording } from "../copy/wording";
import { passesWordingFilter } from "../copy/forbidden";
import type { ReportV1 } from "../score/report";

export const MIN_CONFIDENCE_TO_LABEL: number = reportConfig.minConfidenceToLabel;

export type DisplayStatus = "scored" | "insufficient_evidence";

const NO_PAGES = /^no page could be fetched from /;

/** True when no page of the brand's website was fetched (the pipeline records a "no page" skip). */
export function noPagesFetched(report: Pick<ReportV1, "skipped" | "sources_count">): boolean {
  return report.sources_count === 0 || report.skipped.some((s) => NO_PAGES.test(s.reason));
}

export function displayStatus(report: Pick<ReportV1, "confidence" | "skipped" | "sources_count">, min = MIN_CONFIDENCE_TO_LABEL): DisplayStatus {
  return report.confidence < min || noPagesFetched(report) ? "insufficient_evidence" : "scored";
}

/** "Writing the summary (AI): no AI answer" under step "Writing the summary (AI)" ⇒ "no AI answer". */
export function stripStepPrefix(step: string, reason: string): string {
  const prefix = `${step}: `;
  return reason.startsWith(prefix) ? reason.slice(prefix.length) : reason;
}

const MAX_EXCERPT_WORDS = 18;
const clip = (s: string) => {
  const w = s.split(/\s+/);
  return w.length <= MAX_EXCERPT_WORDS ? s : `${w.slice(0, MAX_EXCERPT_WORDS).join(" ")} …`;
};

export interface FallbackSummary {
  text: string;
  cited_urls: string[];
}

/**
 * The rule-based summary shown when the AI summary is unavailable: a fixed
 * template over the report's own receipts (no LLM). It cites only receipt URLs
 * (pages this report fetched) and skips any excerpt that fails the wording filter.
 */
export function fallbackSummary(report: ReportV1): FallbackSummary {
  const w = reportWording.fallback;
  const parts: string[] = [];
  const cited: string[] = [];
  if (displayStatus(report) === "insufficient_evidence") {
    parts.push(w.insufficient(report.brand));
  } else {
    parts.push(w.opening(report.brand, report.label_text.toLowerCase(), report.signals_count, report.sources_count));
  }
  for (const a of report.axes) {
    if (a.status !== "scored" || a.signals.length === 0) continue;
    const s = a.signals.find((x) => passesWordingFilter(x.excerpt) && passesWordingFilter(x.label));
    if (!s) continue;
    parts.push(w.axisExample(scoreWording.axisNames[a.id], a.signals.length, clip(s.excerpt), s.source_url));
    if (!cited.includes(s.source_url)) cited.push(s.source_url);
  }
  const missing = report.axes.filter((a) => a.status === "missing").map((a) => scoreWording.axisNames[a.id]);
  if (missing.length > 0) parts.push(w.missing(missing));
  if (report.could_not_check.length > 0) parts.push(w.couldNotCheck(report.could_not_check.length));
  const text = parts.join(" ");
  return { text: passesWordingFilter(text) ? text : w.insufficient(report.brand), cited_urls: passesWordingFilter(text) ? cited : [] };
}
