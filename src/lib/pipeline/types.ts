import type { ProgressEntry, Run } from "../db/runs-repo";
import type { FetchedPage } from "../discover/fetch-pages";
import type { Candidate, DiscoveryConfig } from "../discover/heuristics";
import type { Fetcher } from "../fetch/fetcher";
import type { RobotsChecker } from "../fetch/robots";
import type { ClaimHit, ClaimStats } from "../claims/engine";
import type { EvidenceResult } from "../claims/evidence-rules";
import type { Signal } from "./signal";
import type { DiffCandidate, TimelineEntry } from "../wayback/retraction";

/** What every pipeline step returns (PLAN conventions). */
export interface StepResult {
  signals: Signal[];
  skipped?: { step: string; reason: string };
  could_not_check: string[];
  /** Extra progress lines, e.g. one "skipped: robots.txt disallows <url>" line per blocked page. */
  progress?: ProgressEntry[];
}

/** Shared, mutable state passed from step to step within one run. */
export interface PipelineContext {
  run: Pick<Run, "id" | "brand" | "website">;
  /** Robots-guarded fetcher: the only fetcher used for brand, regulator and repair pages (ADR-010). */
  pageFetcher: Fetcher;
  /**
   * Cached, rate-limited fetcher without the robots guard, used only for the
   * brief-mandated API endpoints (Wayback CDX and `id_` snapshots, ADR-010).
   */
  apiFetcher: Fetcher;
  robots: RobotsChecker;
  /** Clock for the run (the Wayback year window); injectable in tests. */
  now: () => Date;
  config: DiscoveryConfig;
  candidates: Candidate[];
  pages: FetchedPage[];
  /** URLs robots.txt disallowed; Phase 4 tries Wayback for these (brief Section 8). */
  robotsDisallowed: string[];
  /** Claim-language counts over all fetched pages (Phase 3; the scorer reads them in Phase 6). */
  claimStats?: ClaimStats;
  claimHits: ClaimHit[];
  /** Evidence-rule findings, including labels claimed (never scored). */
  evidence?: Omit<EvidenceResult, "signals" | "could_not_check">;
  /** Archived claim history per page (Phase 4), oldest snapshot first within a page. */
  timeline: TimelineEntry[];
  /** Removed-claim candidates for the Phase 7 diff classifier. */
  diffCandidates: DiffCandidate[];
}

export interface Step {
  id: string;
  label: (ctx: PipelineContext) => string;
  run: (ctx: PipelineContext) => Promise<StepResult>;
}
