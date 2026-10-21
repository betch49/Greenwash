import { couldNotCheck, reasons, steps } from "../../copy/wording";
import { checkFrRepair, FrParseError, FrUnavailableError, FR_INDEX, type FrIndexConfig } from "../../registries/fr-repair";
import { repairApplicability } from "../../repair/applicability";
import type { Step, StepResult } from "../types";

/**
 * French repairability index (Phase 12, ADR-027), after the repair step. Non-durable brands:
 * skipped with the repair axis's not-applicable reason. data.gouv.fr unreachable or its list
 * unparsable ⇒ "skipped: <reason>" and a could-not-check line; the run goes on. A receipted
 * index signal replaces `repair.no_repair_info_found` (ADR-020) through the step patch.
 */
export function makeFrRepairStep(cfg: FrIndexConfig = FR_INDEX): Step {
  return {
    id: "fr-repair",
    label: () => steps.frRepair,
    async run(ctx): Promise<StepResult> {
      const app = repairApplicability(ctx.run.entity, ctx.config);
      if (!app.applicable) {
        return { signals: [], could_not_check: [couldNotCheck.repairNotApplicable(app.industry)], skipped: { step: steps.frRepair, reason: reasons.repairNotApplicable(app.industry) } };
      }
      let res;
      try {
        res = await checkFrRepair(ctx.run.brand, ctx.pageFetcher, cfg);
      } catch (err) {
        if (!(err instanceof FrUnavailableError) && !(err instanceof FrParseError)) throw err;
        return { signals: [], could_not_check: [couldNotCheck.frRepairSkipped(err.message)], skipped: { step: steps.frRepair, reason: err.message } };
      }
      const result: StepResult = { signals: res.signals, could_not_check: res.could_not_check };
      if (res.signals.length > 0) {
        const replaced = ctx.signals.filter((s) => s.kind === "repair.no_repair_info_found").map((s) => s.id);
        if (replaced.length > 0) result.patch = { remove: replaced };
      } else if (res.parseFailures.length > 0) {
        result.skipped = { step: steps.frRepair, reason: res.parseFailures[0] };
      }
      return result;
    },
  };
}

export const frRepairStep = makeFrRepairStep();
