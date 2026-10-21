import type { ProgressEntry, Run } from "../db/runs-repo";
import { RunPagesRepo } from "../db/run-pages-repo";
import { RunOutputsRepo } from "../db/run-outputs-repo";
import { ReportsRepo } from "../db/reports-repo";
import type { ReportV1 } from "../score/report";
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
  /** Archived-claim timeline (Phase 4); the full report is /report/[id] (Phase 8). */
  timeline: TimelineEntry[];
  /** "What we could not check" lines of a finished run. */
  could_not_check: string[];
  /** Score summary of a finished run (Phase 6) and the id of its report page. */
  score?: ScoreSummary;
}

export interface ScoreSummary {
  report_id: string;
  score: number;
  confidence: number;
  label_text: string;
  /** ai_share as a whole percentage. */
  ai_share_pct: number;
  basis: string;
  /** The AI summary (Phase 7), absent when unavailable or rejected. */
  summary?: string;
}

export function scoreSummary(id: string, r: ReportV1): ScoreSummary {
  return { report_id: id, score: r.score, confidence: r.confidence, label_text: r.label_text, ai_share_pct: Math.round(r.ai_share * 100), basis: r.basis, ...(r.summary ? { summary: r.summary.text } : {}) };
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
    ...scoreOf(new ReportsRepo(db).getByRun(run.id)),
  };
}

const scoreOf = (found: { id: string; report: ReportV1 } | undefined) => (found ? { score: scoreSummary(found.id, found.report) } : {});
