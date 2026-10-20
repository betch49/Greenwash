import { reasons, steps } from "../copy/wording";
import type { ProgressEntry, Run, RunsRepo } from "../db/runs-repo";
import { RunPagesRepo } from "../db/run-pages-repo";
import { RunTimelineRepo } from "../db/run-timeline-repo";
import { getServices } from "../services";
import { runPipeline, type PipelineOutcome } from "./run";

const g = globalThis as unknown as { __grInflight?: Map<string, Promise<PipelineOutcome>> };
const inflight = () => (g.__grInflight ??= new Map());

/**
 * Starts the pipeline for a run, at most once per run (atomic pending ⇒ running
 * claim in SQLite). Called only from an explicit POST (server action), never
 * from a GET render. Returns false when the run was already started or is unknown.
 */
export function startAnalysis(runId: string): boolean {
  const { runs, db, fetcher } = getServices();
  const run = runs.get(runId);
  if (!run || !runs.claimStart(runId)) return false;
  const p = runPipeline(run, { runs, pages: new RunPagesRepo(db), timeline: new RunTimelineRepo(db), fetcher }).finally(() => inflight().delete(runId));
  inflight().set(runId, p);
  return true;
}

/** The in-flight pipeline promise for a run, if this process is running it. */
export const inflightRun = (runId: string) => inflight().get(runId);

/**
 * A run marked `running` that no pipeline in this process is executing was
 * interrupted (server restart, crash). It is marked `failed` and the step that
 * was running becomes "skipped: analysis interrupted …", so the failure is shown
 * instead of an endless "running…" (ADR-013). Single-process assumption: v1 runs
 * one server process. Returns the run as it should be shown.
 */
export function settleInterrupted(run: Run, runs: RunsRepo, isInflight: (id: string) => boolean = (id) => inflightRun(id) !== undefined): Run {
  if (run.status !== "running" || isInflight(run.id)) return run;
  const progress: ProgressEntry[] = run.progress.map((p) =>
    p.status === "running" ? { step: p.step, status: "skipped", reason: reasons.interrupted } : p,
  );
  if (!progress.some((p) => p.reason === reasons.interrupted)) {
    progress.push({ step: steps.pipeline, status: "skipped", reason: reasons.interrupted });
  }
  runs.setProgress(run.id, progress);
  runs.setStatus(run.id, "failed");
  return { ...run, status: "failed", progress };
}
