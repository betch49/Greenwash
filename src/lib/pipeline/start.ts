import { reasons, steps } from "../copy/wording";
import type { ProgressEntry, Run, RunsRepo } from "../db/runs-repo";
import { RunPagesRepo } from "../db/run-pages-repo";
import { RunOutputsRepo } from "../db/run-outputs-repo";
import { ReportsRepo } from "../db/reports-repo";
import { getServices, pipelineClock, type Services } from "../services";
import { runPipeline, type PipelineOutcome } from "./run";
import type { LLMClient } from "../llm/client";
import type { Weights } from "../score/weights";

const g = globalThis as unknown as { __grInflight?: Map<string, Promise<PipelineOutcome>> };
const inflight = () => (g.__grInflight ??= new Map());

/**
 * Starts the pipeline for a run, at most once per run (atomic pending ⇒ running
 * claim in SQLite). Called only from an explicit POST (server action), never
 * from a GET render. Returns false when the run was already started or is unknown.
 */
export function startAnalysis(runId: string): boolean {
  const services = getServices();
  const run = services.runs.get(runId);
  if (!run) return false;
  const started = launchRun({ ...services, now: pipelineClock() }, run);
  if (!started) return false;
  const p = started.finally(() => inflight().delete(runId));
  inflight().set(runId, p);
  return true;
}

/** What a run needs: the app's services, or injected ones (the validation harness, tests). */
export type RunServices = Pick<Services, "db" | "runs" | "fetcher"> & { llm: LLMClient | null; now?: () => Date; weights?: Weights };

/**
 * The one path that executes a run: claims it (pending ⇒ running, at most once)
 * and runs the pipeline with the given services, storing pages, outputs and the
 * report. Returns null when the run was already started.
 */
export function launchRun(services: RunServices, run: Run): Promise<PipelineOutcome> | null {
  const { runs, db, fetcher, llm } = services;
  if (!runs.claimStart(run.id)) return null;
  return runPipeline(run, { runs, pages: new RunPagesRepo(db), outputs: new RunOutputsRepo(db), reports: new ReportsRepo(db), fetcher, llm, now: services.now ?? (() => new Date()), ...(services.weights ? { weights: services.weights } : {}) });
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
