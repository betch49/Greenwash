// Confidence (PLAN Phase 6 deliverable 3): the share of axis weight that rests on data.
import type { Axis } from "../pipeline/signal";
import type { Weights } from "./weights";

export type StepStatus = "done" | "skipped" | "running";
export type AxisStatus = "scored" | "missing" | "not_applicable";

export interface AxisDataInput {
  /** Status of each pipeline step by step id. */
  step_status: Record<string, StepStatus>;
  /** Number of receipted signals on the axis. */
  signals: number;
  /** Archived snapshots read for the timeline (data for the axes in `timelineCountsAsData`). */
  archived_snapshots: number;
}

/**
 * An axis has data when at least one of its steps finished `done` (not skipped)
 * and it produced something: a receipted signal, or, for the axes listed in
 * `timelineCountsAsData`, at least one archived snapshot read.
 */
export function axisHasData(axis: Axis, input: AxisDataInput, w: Weights["confidence"]): boolean {
  const stepDone = w.axisSteps[axis].some((id) => input.step_status[id] === "done");
  const data = input.signals > 0 || (w.timelineCountsAsData.includes(axis) && input.archived_snapshots > 0);
  return stepDone && data;
}

/**
 * Confidence 0–100 = effective weight of the axes with data. A not-applicable
 * axis has effective weight 0 (its weight was redistributed), so it never lowers
 * confidence; a missing axis lowers it by its weight.
 */
export function confidenceOf(axes: { effective_weight: number; status: AxisStatus }[]): number {
  let share = 0;
  for (const a of axes) if (a.status === "scored") share += a.effective_weight;
  return Math.min(100, Math.round(share * 100));
}
