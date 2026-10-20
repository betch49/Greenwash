import type { ProgressEntry, Run } from "../db/runs-repo";
import type { FetchedPage } from "../discover/fetch-pages";
import type { Candidate, DiscoveryConfig } from "../discover/heuristics";
import type { Fetcher } from "../fetch/fetcher";
import type { RobotsChecker } from "../fetch/robots";
import type { Signal } from "./signal";

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
  robots: RobotsChecker;
  config: DiscoveryConfig;
  candidates: Candidate[];
  pages: FetchedPage[];
  /** URLs robots.txt disallowed; Phase 4 tries Wayback for these (brief Section 8). */
  robotsDisallowed: string[];
}

export interface Step {
  id: string;
  label: (ctx: PipelineContext) => string;
  run: (ctx: PipelineContext) => Promise<StepResult>;
}
