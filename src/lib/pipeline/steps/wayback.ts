import { couldNotCheck, reasons, steps } from "../../copy/wording";
import type { ProgressEntry } from "../../db/runs-repo";
import { isSustainabilityPath, urlKey } from "../../discover/heuristics";
import { WAYBACK_CONFIG, WaybackUnavailableError, listSnapshots, yearWindow, type WaybackConfig } from "../../wayback/cdx";
import { detectRetractions } from "../../wayback/retraction";
import { fetchSnapshot, type Snapshot } from "../../wayback/snapshot";
import type { Signal } from "../signal";
import type { PipelineContext, Step, StepResult } from "../types";

/**
 * Pages whose history is pulled: robots-disallowed sustainability-type pages
 * first (we could not fetch them live, brief Section 8), then the fetched
 * sustainability-type pages in fetch order, at most `maxPages`.
 */
export function waybackTargets(ctx: Pick<PipelineContext, "pages" | "robotsDisallowed" | "config">, config: WaybackConfig = WAYBACK_CONFIG): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of [...ctx.robotsDisallowed, ...ctx.pages.map((p) => p.url)]) {
    if (out.length >= config.maxPages) break;
    if (!isSustainabilityPath(url, ctx.config)) continue;
    const key = urlKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

/**
 * Wayback history and the claim retraction detector (differentiator A).
 * The archive unreachable (network error, 429, 5xx, or no CDX answer for any
 * page) ⇒ the step is "skipped: Wayback unreachable (<status>)", keeping
 * whatever was found before the failure; the run continues.
 */
export function makeWaybackStep(config: WaybackConfig = WAYBACK_CONFIG): Step {
  const labelOf = (ctx: PipelineContext) => {
    const { from, to } = yearWindow(ctx.now(), config);
    return steps.wayback(from, to);
  };
  return {
    id: "wayback",
    label: labelOf,
    async run(ctx): Promise<StepResult> {
      const label = labelOf(ctx);
      const targets = waybackTargets(ctx, config);
      // Robots-disallowed pages we do not look up are said so too (ADR-016).
      const disallowed = new Set(ctx.robotsDisallowed);
      for (const url of ctx.robotsDisallowed) {
        if (!targets.includes(url)) ctx.archiveOutcomes[url] = { kind: "not_looked_up", maxPages: config.maxPages };
      }
      /** Records the outcome of a disallowed page; returns true when the page's could-not-check line carries it. */
      const note = (url: string, outcome: PipelineContext["archiveOutcomes"][string]) => {
        if (!disallowed.has(url)) return false;
        ctx.archiveOutcomes[url] = outcome;
        return true;
      };
      if (targets.length === 0) {
        return { signals: [], could_not_check: [], skipped: { step: label, reason: reasons.noPagesForWayback } };
      }
      const now = ctx.now();
      const { from, to } = yearWindow(now, config);
      const signals: Signal[] = [];
      const could_not_check: string[] = [];
      const progress: ProgressEntry[] = [];
      const noAnswer: { url: string; status: number }[] = [];
      const done = (skipReason?: string): StepResult => ({
        signals,
        could_not_check,
        progress,
        ...(skipReason ? { skipped: { step: label, reason: skipReason } } : {}),
      });

      try {
        for (const pageUrl of targets) {
          const list = await listSnapshots(pageUrl, ctx.apiFetcher, now, config);
          if (list.status !== 200) {
            noAnswer.push({ url: pageUrl, status: list.status });
            continue;
          }
          if (list.snapshots.length === 0) {
            if (!note(pageUrl, { kind: "none", from, to })) could_not_check.push(couldNotCheck.waybackNoSnapshots(pageUrl, from, to));
            continue;
          }
          const snaps: Snapshot[] = [];
          for (const s of list.snapshots) {
            const res = await fetchSnapshot(pageUrl, s, ctx.apiFetcher);
            if (res.ok) snaps.push(res.snapshot);
            else progress.push({ step: steps.fetchSnapshot(res.url), status: "skipped", reason: reasons.httpStatus(res.status, res.url) });
          }
          if (snaps.length > 0) note(pageUrl, { kind: "read", count: snaps.length, from: snaps[0].year, to: snaps[snaps.length - 1].year });
          else note(pageUrl, { kind: "none", from, to });
          if (snaps.length === 1) could_not_check.push(couldNotCheck.waybackOneSnapshot(pageUrl, snaps[0].year));
          const det = detectRetractions(snaps, { brand: ctx.run.brand, config });
          signals.push(...det.signals);
          ctx.timeline.push(...det.timeline);
          ctx.diffCandidates.push(...det.candidates);
        }
      } catch (err) {
        if (!(err instanceof WaybackUnavailableError)) throw err;
        for (const url of targets) if (disallowed.has(url) && !ctx.archiveOutcomes[url]) note(url, { kind: "unreachable", reason: err.message });
        could_not_check.push(couldNotCheck.waybackUnreachable(err.message));
        return done(err.message);
      }

      if (noAnswer.length === targets.length) {
        // No page got a CDX answer: the archive is not serving us, not "no history".
        const reason = reasons.waybackUnreachable(`HTTP ${noAnswer[0].status}`);
        for (const n of noAnswer) note(n.url, { kind: "unreachable", reason });
        could_not_check.push(couldNotCheck.waybackUnreachable(reason));
        return done(reason);
      }
      for (const n of noAnswer) {
        if (!note(n.url, { kind: "no_answer", status: n.status })) could_not_check.push(couldNotCheck.waybackNoHistory(n.url, n.status));
      }
      return done();
    },
  };
}

export const waybackStep = makeWaybackStep();
