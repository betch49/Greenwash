import type { ProgressEntry, Run } from "../db/runs-repo";
import { RunPagesRepo } from "../db/run-pages-repo";
import { getServices } from "../services";

/** The public, read-only view of a run served to the /analyse page (no bodies, no text). */
export interface RunView {
  id: string;
  brand: string;
  website: string;
  wikidataId: string | null;
  status: string;
  progress: ProgressEntry[];
  pages: { url: string; title: string; wordCount: number; fetchedAt: string }[];
}

export function toRunView(run: Run): RunView {
  const { db } = getServices();
  const pages = new RunPagesRepo(db).list(run.id).map((p) => ({ url: p.url, title: p.title, wordCount: p.wordCount, fetchedAt: p.fetchedAt }));
  return {
    id: run.id,
    brand: run.brand,
    website: run.website,
    wikidataId: run.wikidataId,
    status: run.status,
    progress: run.progress,
    pages,
  };
}
