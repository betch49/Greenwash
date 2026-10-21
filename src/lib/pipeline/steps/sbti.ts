import { sbtiWording } from "../../copy/wording";
import { FetchError, type FetchResult } from "../../fetch/fetcher";
import { SBTI_CONFIG, entityIds, loadSbtiRows, lookupSbti, sbtiSignals, statusSummary, type SbtiRow } from "../../registries/sbti";
import type { Step, StepResult } from "../types";

/** "HTTP 503" for a status failure after retries, else the error's message. */
const messageOf = (err: unknown) => (err instanceof FetchError && err.status !== undefined ? `HTTP ${err.status}` : err instanceof Error ? err.message : String(err));

const skip = (reason: string): StepResult => ({
  signals: [],
  could_not_check: [sbtiWording.coverage, sbtiWording.skipped(reason)],
  skipped: { step: sbtiWording.step, reason },
});

/**
 * SBTi target status (Phase 11, ADR-026). Runs after the regulator steps. The export is
 * fetched through the robots-guarded, cached fetcher as bytes. Unreachable (throw, non-200)
 * ⇒ "skipped: SBTi export unreachable (<status>)"; unreadable ⇒ "skipped: SBTi export could
 * not be parsed". Possible matches go to the could-not-check list only, never to signals.
 */
export const sbtiStep: Step = {
  id: "sbti",
  label: () => sbtiWording.step,
  async run(ctx): Promise<StepResult> {
    const url = SBTI_CONFIG.exportUrl;
    let res: FetchResult;
    try {
      res = await ctx.pageFetcher.get(url, { binary: true });
    } catch (err) {
      return skip(sbtiWording.unreachable(messageOf(err)));
    }
    if (res.status !== 200) return skip(sbtiWording.unreachable(`HTTP ${res.status}`));
    let rows: SbtiRow[];
    try {
      if (!res.bytes || res.bytes.length === 0) throw new Error("empty body");
      rows = await loadSbtiRows(res, res.bytes);
    } catch {
      return skip(sbtiWording.unparsable);
    }
    const found = lookupSbti(ctx.run.brand, rows, entityIds(ctx.run.entity));
    const signals = found.scored.flatMap((r) => sbtiSignals(r, { url, fetchedAt: res.fetchedAt }, ctx.now()));
    const shown = found.possible.slice(0, SBTI_CONFIG.maxPossible);
    const could_not_check = [sbtiWording.coverage, ...shown.map((r) => sbtiWording.possible(r.company_name, statusSummary(r), url))];
    if (found.possible.length > shown.length) could_not_check.push(sbtiWording.possibleMore(found.possible.length - shown.length));
    return { signals, could_not_check };
  },
};
