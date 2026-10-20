import type { ProgressEntry, Run } from "../db/runs-repo";
import { RunPagesRepo } from "../db/run-pages-repo";
import { RunTimelineRepo } from "../db/run-timeline-repo";
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
    timeline: new RunTimelineRepo(db).list(run.id),
  };
}
