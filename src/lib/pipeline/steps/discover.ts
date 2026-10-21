import { couldNotCheck, reasons, steps } from "../../copy/wording";
import { discoverCandidates } from "../../discover/discover";
import type { Step } from "../types";

export const discoverStep: Step = {
  id: "discover",
  label: () => steps.discover,
  async run(ctx) {
    let website: URL;
    try {
      website = new URL(ctx.run.website);
    } catch {
      return { signals: [], could_not_check: [], skipped: { step: steps.discover, reason: reasons.invalidWebsite(ctx.run.website) } };
    }
    // robots.txt unreadable ⇒ the whole site is skipped with the reason shown (ADR-012).
    const unavailable = await ctx.robots.unavailable(website.origin);
    if (unavailable) {
      return {
        signals: [],
        could_not_check: [couldNotCheck.robotsUnavailable(website.origin)],
        skipped: { step: steps.discover, reason: unavailable },
      };
    }
    const { candidates } = await discoverCandidates(website.toString(), ctx.pageFetcher, ctx.robots, ctx.config);
    ctx.candidates = candidates;
    if (candidates.length === 0) {
      return { signals: [], could_not_check: [], skipped: { step: steps.discover, reason: reasons.noCandidates } };
    }
    return { signals: [], could_not_check: [] };
  },
};
