import type { ProgressEntry, Run, RunsRepo } from "../db/runs-repo";
import type { RunPagesRepo } from "../db/run-pages-repo";
import type { RunOutputsRepo } from "../db/run-outputs-repo";
import type { FetchedPage } from "../discover/fetch-pages";
import { DISCOVERY_CONFIG, type DiscoveryConfig } from "../discover/heuristics";
import type { Fetcher } from "../fetch/fetcher";
import { RobotsChecker, RobotsGuardedFetcher } from "../fetch/robots";
import { couldNotCheck, steps } from "../copy/wording";
import { withReceipts, type Signal } from "./signal";
import type { ClaimStats } from "../claims/engine";
import { claimsStep } from "./steps/claims";
import { discoverStep } from "./steps/discover";
import { evidenceStep } from "./steps/evidence";
import { fetchPagesStep } from "./steps/fetch-pages";
import { waybackStep } from "./steps/wayback";
import { asaStep, jdpStep } from "./steps/regulators";
import { repairStep } from "./steps/repair";
import type { PossibleMatch } from "../regulators/check";
import type { DiffCandidate, TimelineEntry } from "../wayback/retraction";
import type { PipelineContext, Step } from "./types";

/** Brief Section 5 order: discover → fetch current pages → Wayback snapshots + diff → claim engine → evidence → regulator checks → repair checks. */
export const DEFAULT_STEPS: Step[] = [discoverStep, fetchPagesStep, waybackStep, claimsStep, evidenceStep, asaStep, jdpStep, repairStep];

export interface PipelineDeps {
  runs: RunsRepo;
  pages: RunPagesRepo;
  /** Stores the timeline and could-not-check lines (Phase 4); optional so step-level tests can omit it. */
  outputs?: RunOutputsRepo;
  /**
   * The cached (+ rate-limited) fetcher, or the fixture fetcher offline. Wrapped in the robots guard
   * for brand pages; used as is only for the Wayback API endpoints (ADR-010).
   */
  fetcher: Fetcher;
  now?: () => Date;
  config?: DiscoveryConfig;
  steps?: Step[];
}

export interface PipelineOutcome {
  status: "done" | "failed";
  progress: ProgressEntry[];
  signals: Signal[];
  could_not_check: string[];
  pages: FetchedPage[];
  claim_stats?: ClaimStats;
  timeline: TimelineEntry[];
  diff_candidates: DiffCandidate[];
  /** Possible regulator matches (shown, not scored; never in `signals`). */
  regulator_possible: PossibleMatch[];
  repair_axis?: "applicable" | "not_applicable";
}

/** Every brand, regulator and repair page goes through this guard (ADR-010). */
export function guardedPageFetcher(fetcher: Fetcher): { pageFetcher: Fetcher; robots: RobotsChecker } {
  const robots = new RobotsChecker(fetcher);
  return { pageFetcher: new RobotsGuardedFetcher(fetcher, robots), robots };
}

/**
 * One "What we could not check" line per robots-disallowed page, saying what the
 * archive gave us instead (brief Section 8: "rely on Wayback for those and say so",
 * ADR-016). Written after all steps, so the Wayback step's outcome is known.
 */
export function robotsLines(ctx: Pick<PipelineContext, "robotsDisallowed" | "archiveOutcomes">): string[] {
  return ctx.robotsDisallowed.map((url) => couldNotCheck.robotsDisallowed(url, ctx.archiveOutcomes[url]));
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Runs the steps in order, persisting progress after every change. A step that
 * throws or reports `skipped` is shown as "skipped: <reason>" and the run
 * continues with the next step; nothing is hidden. Signals without a receipt
 * are dropped (assertReceipt rule).
 */
export async function runPipeline(run: Pick<Run, "id" | "brand" | "website"> & { entity?: unknown }, deps: PipelineDeps): Promise<PipelineOutcome> {
  const { pageFetcher, robots } = guardedPageFetcher(deps.fetcher);
  const ctx: PipelineContext = {
    run,
    pageFetcher,
    apiFetcher: deps.fetcher,
    robots,
    now: deps.now ?? (() => new Date()),
    config: deps.config ?? DISCOVERY_CONFIG,
    candidates: [],
    pages: [],
    robotsDisallowed: [],
    claimHits: [],
    timeline: [],
    diffCandidates: [],
    archiveOutcomes: {},
    rulings: [],
    regulatorPossible: [],
    repairFindings: [],
  };
  const progress: ProgressEntry[] = [];
  const signals: Signal[] = [];
  const could_not_check: string[] = [];
  const save = () => deps.runs.setProgress(run.id, progress);
  let robotsAdded = false;
  const addRobotsLines = () => {
    if (robotsAdded) return;
    robotsAdded = true;
    could_not_check.push(...robotsLines(ctx));
  };

  try {
    for (const step of deps.steps ?? DEFAULT_STEPS) {
      const entry: ProgressEntry = { step: step.label(ctx), status: "running" };
      progress.push(entry);
      save();
      try {
        const res = await step.run(ctx);
        if (res.skipped) {
          entry.status = "skipped";
          entry.reason = res.skipped.reason;
        } else {
          entry.status = "done";
        }
        progress.push(...(res.progress ?? []));
        signals.push(...withReceipts(res.signals));
        for (const line of res.could_not_check) if (!could_not_check.includes(line)) could_not_check.push(line);
      } catch (err) {
        entry.status = "skipped";
        entry.reason = messageOf(err);
      }
      save();
    }
    deps.pages.replace(run.id, ctx.pages);
    addRobotsLines();
    deps.outputs?.replace(run.id, { timeline: ctx.timeline, could_not_check });
    deps.runs.setStatus(run.id, "done");
    return { status: "done", progress, signals, could_not_check, pages: ctx.pages, claim_stats: ctx.claimStats, timeline: ctx.timeline, diff_candidates: ctx.diffCandidates, regulator_possible: ctx.regulatorPossible, repair_axis: ctx.repairAxis };
  } catch (err) {
    addRobotsLines();
    progress.push({ step: steps.pipeline, status: "skipped", reason: messageOf(err) });
    try {
      save();
      deps.runs.setStatus(run.id, "failed");
    } catch {
      // The database itself failed; nothing more can be recorded.
    }
    return { status: "failed", progress, signals, could_not_check, pages: ctx.pages, claim_stats: ctx.claimStats, timeline: ctx.timeline, diff_candidates: ctx.diffCandidates, regulator_possible: ctx.regulatorPossible, repair_axis: ctx.repairAxis };
  }
}
