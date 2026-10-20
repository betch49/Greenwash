import type { ProgressEntry, Run } from "../db/runs-repo";
import { RunPagesRepo } from "../db/run-pages-repo";
import { RunOutputsRepo } from "../db/run-outputs-repo";
import type { TimelineEntry } from "../wayback/retraction";
import { getServices } from "../services";
import { settleInterrupted } from "./start";

/** The public, read-only view of a run served to the /analyse page (no bodies, no text). */
export interface RunView {
  id: string;
  brand: string;
  website: string;
  wikidataId: string | null;
  status: string;
  progress: ProgressEntry[];
  pages: { url: string; title: string; wordCount: number; fetchedAt: string }[];
  /** Archived-claim timeline (Phase 4); the full report UI arrives in Phase 8. */
  timeline: TimelineEntry[];
  /** "What we could not check" lines of a finished run. */
  could_not_check: string[];
}

export function toRunView(stored: Run): RunView {
  const { db, runs } = getServices();
  const run = settleInterrupted(stored, runs);
  const pages = new RunPagesRepo(db).list(run.id).map((p) => ({ url: p.url, title: p.title, wordCount: p.wordCount, fetchedAt: p.fetchedAt }));
  return {
    id: run.id,
    brand: run.brand,
    website: run.website,
    wikidataId: run.wikidataId,
    status: run.status,
    progress: run.progress,
    pages,
    ...new RunOutputsRepo(db).get(run.id),
  };
}
