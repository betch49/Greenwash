import type { ProgressEntry, Run } from "../db/runs-repo";
import type { FetchedPage } from "../discover/fetch-pages";
import type { Candidate, DiscoveryConfig } from "../discover/heuristics";
import type { Fetcher } from "../fetch/fetcher";
import type { RobotsChecker } from "../fetch/robots";
import type { ClaimHit, ClaimStats } from "../claims/engine";
import type { EvidenceResult } from "../claims/evidence-rules";
import type { Signal } from "./signal";
import type { ArchiveNote } from "../copy/wording";
import type { DiffCandidate, TimelineEntry } from "../wayback/retraction";
import type { Ruling } from "../regulators/adapter";
import type { PossibleMatch } from "../regulators/check";
import type { RepairFinding } from "../repair/brand-pages";
import type { LLMCallLog, LLMClient } from "../llm/client";

/** What every pipeline step returns (PLAN conventions). */
export interface StepResult {
  signals: Signal[];
  skipped?: { step: string; reason: string };
  could_not_check: string[];
  /** Extra progress lines, e.g. one "skipped: robots.txt disallows <url>" line per blocked page. */
  progress?: ProgressEntry[];
  /**
   * Changes to signals emitted by earlier steps (Phase 7 diff classifier only):
   * `remove` drops signals by id, `replace` swaps a signal for one with the same id.
   * A patch can never add a signal.
   */
  patch?: { remove?: string[]; replace?: Signal[] };
}

/** Shared, mutable state passed from step to step within one run. */
export interface PipelineContext {
  /** `entity` is the confirmed Wikidata candidate (absent on the URL fallback); the repair step reads its industry. */
  run: Pick<Run, "id" | "brand" | "website"> & { entity?: unknown };
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
  /** What the Wayback step found for each robots-disallowed page (ADR-016), keyed by the page URL. */
  archiveOutcomes: Record<string, ArchiveOutcome>;
  /** Rulings attributed to the brand (Phase 5); each is also a `regulator.ruling` signal. */
  rulings: (Ruling & { regulator: string })[];
  /** Rulings naming an entity that only contains the brand's name: shown, never scored (ADR-003). */
  regulatorPossible: PossibleMatch[];
  /** Repair axis applicability (Phase 5): "not_applicable" for food and drink brands. */
  repairAxis?: "applicable" | "not_applicable";
  repairFindings: RepairFinding[];
  /** The LLM client (Phase 7); null ⇒ the LLM steps are skipped. */
  llm: LLMClient | null;
  /** Every LLM call made in the run (ReportV1.llm_calls). */
  llmCalls: LLMCallLog[];
  /** Receipted signals accumulated so far (read-only for steps; change them with `patch`). */
  signals: readonly Signal[];
}

/** The archive's answer for a page we could not fetch live (type lives with its wording). */
export type ArchiveOutcome = ArchiveNote;

export interface Step {
  id: string;
  label: (ctx: PipelineContext) => string;
  run: (ctx: PipelineContext) => Promise<StepResult>;
}
