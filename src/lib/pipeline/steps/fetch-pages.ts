import { couldNotCheck, reasons, steps } from "../../copy/wording";
import { fetchPages } from "../../discover/fetch-pages";
import { isSustainabilityPath } from "../../discover/heuristics";
import type { ProgressEntry } from "../../db/runs-repo";
import { displayHost } from "../../website";
import type { Step } from "../types";

export const fetchPagesStep: Step = {
  id: "fetchPages",
  label: () => steps.fetchPages,
  async run(ctx) {
    const host = displayHost(ctx.run.website);
    if (ctx.candidates.length === 0) {
      return { signals: [], could_not_check: [], skipped: { step: steps.fetchPages, reason: reasons.noCandidates } };
    }
    const res = await fetchPages(ctx.candidates, ctx.pageFetcher, ctx.config);
    ctx.pages = res.pages;
    ctx.robotsDisallowed = res.skipped.filter((s) => s.robots).map((s) => s.url);
    const progress: ProgressEntry[] = res.skipped.map((s) => ({ step: steps.fetchPage(s.url), status: "skipped", reason: s.reason }));
    const could_not_check = ctx.robotsDisallowed.map((u) => couldNotCheck.robotsDisallowed(u));
    if (!res.pages.some((p) => isSustainabilityPath(p.url, ctx.config))) {
      could_not_check.push(couldNotCheck.noSustainabilityPage(host));
    }
    if (res.pages.length === 0) {
      return { signals: [], could_not_check, progress, skipped: { step: steps.fetchPages, reason: reasons.noPages(host) } };
    }
    return { signals: [], could_not_check, progress };
  },
};
