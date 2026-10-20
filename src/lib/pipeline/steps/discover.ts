import { reasons, steps } from "../../copy/wording";
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
    const { candidates } = await discoverCandidates(website.toString(), ctx.pageFetcher, ctx.robots, ctx.config);
    ctx.candidates = candidates;
    if (candidates.length === 0) {
      return { signals: [], could_not_check: [], skipped: { step: steps.discover, reason: reasons.noCandidates } };
    }
    return { signals: [], could_not_check: [] };
  },
};
