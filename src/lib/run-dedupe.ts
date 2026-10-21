// Server-side dedupe of run creation (QA fix round): a double-submitted form
// ("Continue with this website" clicked twice) reuses the run created a moment
// ago for the same brand and website instead of creating a second one.
import type { RunsRepo } from "./db/runs-repo";

/** A second identical submit within this window reuses the first run. */
export const DEDUPE_WINDOW_MS = 15_000;

type Entry = { runId: string; at: number };
const g = globalThis as unknown as { __grRecentRuns?: Map<string, Entry> };
const recent = () => (g.__grRecentRuns ??= new Map());

export function dedupeKey(parts: { website: string; brand: string; wikidataId?: string | null }): string {
  return JSON.stringify([parts.website, parts.brand, parts.wikidataId ?? null]);
}

/**
 * Returns the id of a run created for the same key within the window (still pending or
 * running), or creates one through `create` and remembers it.
 */
export function createOnce(runs: Pick<RunsRepo, "get">, key: string, create: () => { id: string }, now = Date.now()): string {
  const map = recent();
  for (const [k, e] of map) if (now - e.at > DEDUPE_WINDOW_MS) map.delete(k);
  const hit = map.get(key);
  if (hit) {
    const run = runs.get(hit.runId);
    if (run && (run.status === "pending" || run.status === "running")) return hit.runId;
  }
  const { id } = create();
  map.set(key, { runId: id, at: now });
  return id;
}

/** Test hook. */
export function clearRecentRuns(): void {
  recent().clear();
}
