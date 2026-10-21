import config from "../../../../config/registries.json";
import { litigationWording as lw } from "../../copy/wording";
import type { ProgressEntry } from "../../db/runs-repo";
import type { Fetcher } from "../../fetch/fetcher";
import { caseSignal, coverageCountries, matchCase, sabin, SabinParseError, SEED_INDEX, SabinUnavailableError, type Case, type CaseAdapter } from "../../registries/sabin";
import type { Signal } from "../signal";
import type { Step, StepResult } from "../types";

export interface LitigationCheck {
  signals: Signal[];
  cases: (Case & { party: string })[];
  possible: { url: string; title: string; party: string }[];
  could_not_check: string[];
  progress: ProgressEntry[];
}

/**
 * Discovers candidate cases (country + US geography listings, seed index), reads each case
 * page (at most `maxCases`) and matches the parties in its title. A scored match is a
 * `litigation.case` signal; a possible one is a could-not-check line, never a signal.
 * Discovery failing throws SabinUnavailableError; one case page failing is a progress line.
 * The coverage sentence is always the first could-not-check line (criterion 13.7).
 */
export async function checkLitigation(
  brand: string,
  entity: unknown,
  fetcher: Fetcher,
  now: Date,
  adapter: CaseAdapter = sabin,
  maxCases: number = config.sabin.maxCases,
): Promise<LitigationCheck> {
  const d = await adapter.discover(brand, entity, fetcher);
  const out: LitigationCheck = { signals: [], cases: [], possible: [], could_not_check: [lw.coverage(d.countries, d.seedCount)], progress: [] };
  for (const c of d.unknownCountries) out.could_not_check.push(lw.noCountrySlug(c));
  for (const cand of d.candidates.slice(0, maxCases)) {
    let page: Case;
    try {
      page = await adapter.fetchCase(cand.url, fetcher);
    } catch (err) {
      if (!(err instanceof SabinUnavailableError) && !(err instanceof SabinParseError)) throw err;
      const reason = err instanceof SabinParseError ? lw.caseUnparsed(cand.url) : err.message;
      out.progress.push({ step: lw.fetchCase(cand.url), status: "skipped", reason });
      out.could_not_check.push(lw.caseSkipped(cand.url, reason));
      continue;
    }
    // The title on the page decides, never the listing or the seed index (ADR-028).
    const m = matchCase(brand, page.title);
    if (m.kind === "scored" && m.party) {
      out.cases.push({ ...page, party: m.party });
      out.signals.push(caseSignal(page, m.party, now));
    } else if (m.kind === "possible" && m.party) {
      out.possible.push({ url: page.url, title: page.title, party: m.party });
      out.could_not_check.push(lw.possible(m.party, page.url));
    }
  }
  return out;
}

/** Step `sabin` (PLAN Phase 13 deliverable 5): runs after `jdp-fr`; on the track axis. */
export const sabinStep: Step = {
  id: "sabin",
  label: () => lw.step,
  async run(ctx): Promise<StepResult> {
    try {
      const res = await checkLitigation(ctx.run.brand, ctx.run.entity, ctx.pageFetcher, ctx.now());
      return { signals: res.signals, could_not_check: res.could_not_check, progress: res.progress };
    } catch (err) {
      if (!(err instanceof SabinUnavailableError) && !(err instanceof SabinParseError)) throw err;
      const coverage = lw.coverage(coverageCountries(ctx.run.entity), SEED_INDEX.length);
      return { signals: [], could_not_check: [coverage, lw.skipped(err.message)], skipped: { step: lw.step, reason: err.message } };
    }
  },
};
