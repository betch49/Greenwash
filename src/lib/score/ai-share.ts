// ADR-007: the share of a score that depends on an LLM, and the guard that keeps it at or below the cap.
import type { Signal } from "../pipeline/signal";

/** One axis as the guard sees it: its effective weight and two capped sub-scores. */
export interface AxisPart {
  weight: number;
  /** Capped sub-score (0–100) from every signal of the axis. */
  total: number;
  /** Capped sub-score (0–100) from the signals with `llm_used: false` only. */
  nonLlm: number;
}

export interface GuardResult {
  /** The weighted score (0–100, unrounded) after the guard. */
  score: number;
  /** Weighted points from non-LLM signals. */
  nonLlmPoints: number;
  /** Weighted points that LLM signals add to the score, after the guard. */
  llmPoints: number;
  /** llmPoints / score, 0 when the score is 0. Never above `maxShare`. */
  aiShare: number;
  /** True when the guard lowered the LLM points. */
  scaled: boolean;
}

/**
 * LLM points of an axis are what LLM signals add on top of the axis's non-LLM
 * sub-score (both capped), so they never take points away from a rule-based
 * signal. If LLM points would exceed `maxShare` of the score, they are scaled
 * down until they are exactly `maxShare` of it (with the brief's 0.5: equal to the
 * non-LLM points). With no non-LLM points, LLM signals add nothing.
 *
 * The result is min(total, nonLlm / (1 − maxShare)): both terms only fall when a
 * signal is removed, so the guard keeps "missing data never increases the score".
 */
export function applyLlmGuard(parts: AxisPart[], maxShare: number): GuardResult {
  let total = 0;
  let nonLlm = 0;
  for (const p of parts) {
    total += p.weight * Math.max(p.total, p.nonLlm);
    nonLlm += p.weight * p.nonLlm;
  }
  const ceiling = nonLlm / (1 - maxShare);
  const score = Math.min(total, ceiling);
  const llmPoints = Math.max(0, score - nonLlm);
  const aiShare = score > 0 ? Math.min(maxShare, llmPoints / score) : 0;
  return { score, nonLlmPoints: nonLlm, llmPoints, aiShare, scaled: total > ceiling };
}

/** Ids of the signals that depended on an LLM call (logged in every report, brief Section 4). */
export const llmSignalIds = (signals: Pick<Signal, "id" | "llm_used">[]): string[] => signals.filter((s) => s.llm_used).map((s) => s.id);
