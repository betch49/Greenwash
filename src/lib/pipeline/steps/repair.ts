import { couldNotCheck, reasons, steps } from "../../copy/wording";
import { repairApplicability } from "../../repair/applicability";
import { evaluateRepairPages } from "../../repair/brand-pages";
import { lookupIfixit } from "../../repair/ifixit";
import type { Step, StepResult } from "../types";

/**
 * Repair axis (differentiator E): brand-page repair rules over the fetched pages
 * (the discovery heuristics already include /repair, /warranty and /support) plus
 * the iFixit device-category lookup. A food or drink brand (non-durable industry)
 * ⇒ the axis is not applicable: skipped with that reason, no signal, one
 * could-not-check line. iFixit unavailable ⇒ a could-not-check line; the page rules
 * still run. The step is skipped when no page was fetched and iFixit gave nothing.
 */
export const repairStep: Step = {
  id: "repair",
  label: () => steps.repair,
  async run(ctx): Promise<StepResult> {
    const app = repairApplicability(ctx.run.entity, ctx.config);
    if (!app.applicable) {
      ctx.repairAxis = "not_applicable";
      return { signals: [], could_not_check: [couldNotCheck.repairNotApplicable(app.industry)], skipped: { step: steps.repair, reason: reasons.repairNotApplicable(app.industry) } };
    }
    ctx.repairAxis = "applicable";
    const pagesRes = evaluateRepairPages(ctx.pages);
    ctx.repairFindings = pagesRes.findings;
    const ifixit = await lookupIfixit(ctx.run.brand, ctx.pageFetcher);
    const could_not_check = [...ifixit.could_not_check];
    if (ctx.pages.length === 0) could_not_check.push(couldNotCheck.repairNoPages);
    const result: StepResult = { signals: [...pagesRes.signals, ...ifixit.signals], could_not_check, progress: ifixit.progress };
    if (ctx.pages.length === 0 && ifixit.signals.length === 0) result.skipped = { step: steps.repair, reason: reasons.noPagesToScan };
    return result;
  },
};
