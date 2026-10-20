import { RunPagesRepo } from "../db/run-pages-repo";
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
  const p = runPipeline(run, { runs, pages: new RunPagesRepo(db), fetcher }).finally(() => inflight().delete(runId));
  inflight().set(runId, p);
  return true;
}

/** The in-flight pipeline promise for a run, if this process is running it. */
export const inflightRun = (runId: string) => inflight().get(runId);
