// The deterministic scorer (brief Section 4, PLAN Phase 6 deliverable 2). Every
// number comes from config/weights.json; no LLM output decides a number here.
import { scoreWording } from "../copy/wording";
import { ReceiptError, receiptProblem, type Axis, type Signal } from "../pipeline/signal";
import { applyLlmGuard, llmSignalIds } from "./ai-share";
import { axisHasData, confidenceOf, type AxisStatus, type StepStatus } from "./confidence";
import { AXES, CLAIMS_FORMULA_SHARE, WEIGHTS, type Weights } from "./weights";

export type ScoreLabel = "low" | "moderate" | "high";

export interface ScoreInput {
  signals: Signal[];
  /** Visible words on the fetched pages (the claims axis is a rate per `claimsRate.perWords` words). */
  words_scanned: number;
  /** Repair axis applicability from the repair step; absent means applicable. */
  repair_axis?: "applicable" | "not_applicable";
  /** Status of each pipeline step by step id. */
  step_status: Record<string, StepStatus>;
  /** Archived snapshots read for the timeline. */
  archived_snapshots: number;
  /**
   * Claim-language counts over all fetched pages (ClaimStats). When present they
   * are the rule-based claims-axis input and `wordCount` is the rate's
   * denominator; LLM claim signals are added on top by their points. When absent,
   * the rule-based claim signals are counted once each.
   */
  claim_stats?: ClaimCounts;
}

export interface ClaimCounts {
  matches: number;
  unsupported: number;
  wordCount: number;
}

export interface AxisScore {
  id: Axis;
  /** Configured weight (config/weights.json). */
  weight: number;
  /** Weight after a not-applicable axis was redistributed. */
  effective_weight: number;
  status: AxisStatus;
  /** 0–100, rounded for display. */
  subscore: number;
  signals: Signal[];
}

export interface ScoreResult {
  score: number;
  label: ScoreLabel;
  label_text: string;
  confidence: number;
  ai_share: number;
  llm_signal_ids: string[];
  axes: AxisScore[];
  signals_count: number;
  sources_count: number;
  /** "Based on N verified signals from M sources." */
  basis: string;
  /** Signals dropped for a missing receipt (production mode only; development throws). */
  rejected: { id: string; reason: string }[];
}

export interface ScoreOptions {
  weights?: Weights;
  /** "dev" throws on a signal without a receipt; "prod" drops and logs it. Default: from NODE_ENV. */
  mode?: "dev" | "prod";
  log?: (message: string) => void;
}

const defaultMode = (): "dev" | "prod" => (process.env.NODE_ENV === "production" ? "prod" : "dev");

/** Risk points of one signal: the kind's points × its weight_hint (unknown kinds score 0). */
export function signalPoints(s: Pick<Signal, "axis" | "kind" | "weight_hint">, w: Weights = WEIGHTS): number {
  const table: Record<string, number> = w.points[s.axis] ?? {};
  const pts = table[s.kind] ?? 0;
  const hint = Number.isFinite(s.weight_hint) ? Math.max(0, s.weight_hint) : 0;
  return pts * hint;
}

/** Sum of the risk points of a set of signals. */
export function rawPoints(signals: Pick<Signal, "axis" | "kind" | "weight_hint">[], w: Weights = WEIGHTS): number {
  let raw = 0;
  for (const s of signals) raw += signalPoints(s, w);
  return raw;
}

/**
 * Rule-based claims-axis points from the run's ClaimStats (ADR-015: the family
 * counts stay the claims-axis input; a repeated sentence counts every time).
 */
export function claimStatsPoints(stats: ClaimCounts, w: Weights = WEIGHTS): number {
  const supported = Math.max(0, stats.matches - stats.unsupported);
  return stats.unsupported * (w.points.claims["claim.unsupported"] ?? 0) + supported * (w.points.claims["claim.supported"] ?? 0);
}

/** Claim-sentence counts of the claims axis (Phase 14, formula v2): matched `m`, unsupported `u`, supported `s`. */
export interface ClaimShareCounts {
  m: number;
  u: number;
  s: number;
}

const isClaimKind = (kind: string) => kind === "claim.unsupported" || kind === "claim.supported";

/**
 * Counts claim sentences for formula v2. With ClaimStats, the rule-based part is
 * the stats (matches, unsupported, supported = the rest); without, every
 * rule-based claim signal counts once. LLM claim signals (not in ClaimStats)
 * count once each on top, by their kind.
 */
export function claimShareCounts(signals: Pick<Signal, "kind" | "llm_used">[], stats: ClaimCounts | undefined, includeLlm = true): ClaimShareCounts {
  let m = 0;
  let u = 0;
  if (stats) {
    m = Math.max(0, stats.matches);
    u = Math.min(m, Math.max(0, stats.unsupported));
  }
  for (const sig of signals) {
    if (!isClaimKind(sig.kind)) continue;
    if (sig.llm_used ? !includeLlm : !!stats) continue;
    m++;
    if (sig.kind === "claim.unsupported") u++;
  }
  return { m, u, s: m - u };
}

/** v2 `supportedWeight`: the ratio of the two claim kinds' points (never duplicated in the config). */
export function supportedWeight(w: Weights = WEIGHTS): number {
  const unsupported = w.points.claims["claim.unsupported"] ?? 0;
  const supported = w.points.claims["claim.supported"] ?? 0;
  return unsupported > 0 ? supported / unsupported : 0;
}

/**
 * Claims formula v2 (ADR-030): 100 × (u + supportedWeight × s) ÷ m, capped. Below
 * `claimsRate.v2.minClaims` matched sentences the axis has insufficient data and
 * contributes 0 (the caller sets the status and lowers confidence).
 */
export function claimsShareSubscore(c: ClaimShareCounts, w: Weights = WEIGHTS): { subscore: number; insufficient: boolean } {
  if (c.m < w.claimsRate.v2.minClaims || c.m <= 0) return { subscore: 0, insufficient: true };
  const share = (c.u + supportedWeight(w) * c.s) / c.m;
  return { subscore: Math.min(w.caps.claims, Math.min(100, Math.max(0, share * 100))), insufficient: false };
}

/**
 * Sub-score 0–100 of one axis from its raw points, capped. The claims axis is a
 * rate: points per `perWords` words (at least `minWords` counted, so a short page
 * cannot inflate it) × `subscorePerPointPer1000Words`.
 */
export function axisSubscore(axis: Axis, raw: number, wordsScanned: number, w: Weights = WEIGHTS): number {
  let v = raw;
  if (axis === "claims") {
    const words = Math.max(wordsScanned, w.claimsRate.minWords);
    v = ((raw * w.claimsRate.perWords) / words) * w.claimsRate.subscorePerPointPer1000Words;
  }
  return Math.min(w.caps[axis], Math.min(100, Math.max(0, v)));
}

/** Weighted sum of sub-scores (0–100 each) with weights summing to 1. */
export function weightedSum(subscores: Record<Axis, number>, weights: Record<Axis, number>): number {
  let sum = 0;
  for (const a of AXES) sum += subscores[a] * weights[a];
  return sum;
}

/** Axis weights after a not-applicable axis is removed and its weight shared out in proportion. */
export function effectiveWeights(notApplicable: Axis[], w: Weights = WEIGHTS): Record<Axis, number> {
  let applicable = 0;
  for (const a of AXES) if (!notApplicable.includes(a)) applicable += w.axes[a];
  const out = {} as Record<Axis, number>;
  for (const a of AXES) out[a] = notApplicable.includes(a) || applicable === 0 ? 0 : w.axes[a] / applicable;
  return out;
}

export function labelFor(score: number, w: Weights = WEIGHTS): ScoreLabel {
  if (score >= w.labels.highFrom) return "high";
  if (score >= w.labels.moderateFrom) return "moderate";
  return "low";
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url;
  }
};

/** Scores a run's signals. Signals without a receipt never reach a sub-score. */
export function score(input: ScoreInput, opts: ScoreOptions = {}): ScoreResult {
  const w = opts.weights ?? WEIGHTS;
  const mode = opts.mode ?? defaultMode();
  const log = opts.log ?? ((m: string) => console.warn(m));

  const rejected: { id: string; reason: string }[] = [];
  const kept: Signal[] = [];
  for (const s of input.signals) {
    const problem = receiptProblem(s);
    if (!problem) {
      kept.push(s);
      continue;
    }
    if (mode === "dev") throw new ReceiptError(`scorer: signal rejected: ${problem}`, s);
    rejected.push({ id: String(s?.id ?? ""), reason: problem });
    log(`scorer: signal ${String(s?.id ?? "")} dropped (${problem})`);
  }

  const notApplicable: Axis[] = input.repair_axis === "not_applicable" ? ["repair"] : [];
  const eff = effectiveWeights(notApplicable, w);

  const axes: AxisScore[] = [];
  const parts = [];
  const scored: Signal[] = [];
  for (const a of AXES) {
    const na = notApplicable.includes(a);
    const signals = na ? [] : kept.filter((s) => s.axis === a);
    scored.push(...signals);
    const llmRaw = rawPoints(signals.filter((s) => s.llm_used), w);
    const ruleSignals = signals.filter((s) => !s.llm_used);
    const ruleRaw = a === "claims" && input.claim_stats ? claimStatsPoints(input.claim_stats, w) : rawPoints(ruleSignals, w);
    const words = a === "claims" && input.claim_stats ? input.claim_stats.wordCount : input.words_scanned;
    let total = axisSubscore(a, ruleRaw + llmRaw, words, w);
    let nonLlm = axisSubscore(a, ruleRaw, words, w);
    let insufficient = false;
    if (a === "claims" && !na && w.claimsRate.version === CLAIMS_FORMULA_SHARE) {
      // Formula v2: share of unsupported claim sentences; the non-LLM part is the share over rule-based sentences alone.
      const all = claimsShareSubscore(claimShareCounts(signals, input.claim_stats, true), w);
      const rule = claimsShareSubscore(claimShareCounts(signals, input.claim_stats, false), w);
      insufficient = all.insufficient;
      total = insufficient ? 0 : all.subscore;
      nonLlm = insufficient || rule.insufficient ? 0 : rule.subscore;
    }
    parts.push({ weight: eff[a], total, nonLlm });
    const stepDone = w.confidence.axisSteps[a].some((id) => input.step_status[id] === "done");
    const status: AxisStatus = na
      ? "not_applicable"
      : insufficient && stepDone
        ? w.claimsRate.v2.insufficientDataStatus
        : axisHasData(a, { step_status: input.step_status, signals: signals.length, archived_snapshots: input.archived_snapshots }, w.confidence)
          ? "scored"
          : "missing";
    axes.push({ id: a, weight: w.axes[a], effective_weight: eff[a], status, subscore: Math.round(total), signals });
  }

  const guard = applyLlmGuard(parts, w.llmGuard.maxShare);
  const final = Math.round(guard.score);
  const label = labelFor(final, w);
  const sources = new Set(scored.map((s) => hostOf(s.source_url))).size;
  return {
    score: final,
    label,
    label_text: scoreWording.label[label],
    confidence: confidenceOf(axes),
    ai_share: guard.aiShare,
    llm_signal_ids: llmSignalIds(scored),
    axes,
    signals_count: scored.length,
    sources_count: sources,
    basis: scoreWording.basis(scored.length, sources),
    rejected,
  };
}
