import { couldNotCheck, steps } from "../../copy/wording";
import { RegulatorUnavailableError, type RegulatorAdapter } from "../../regulators/adapter";
import { asaUk } from "../../regulators/asa-uk";
import { checkRegulator } from "../../regulators/check";
import { jdpFr } from "../../regulators/jdp-fr";
import type { Step, StepResult } from "../types";

/**
 * One step per regulator (differentiator C). Site unreachable, robots.txt, or a
 * page we cannot parse ⇒ "skipped: <reason>" for this step only; the next
 * adapter still runs. Possible matches go to ctx.regulatorPossible and to the
 * could-not-check list, never to signals.
 */
export function makeRegulatorStep(adapter: RegulatorAdapter, label: string): Step {
  return {
    id: adapter.id,
    label: () => label,
    async run(ctx): Promise<StepResult> {
      const coverage = couldNotCheck.regulatorCoverage;
      try {
        const res = await checkRegulator(adapter, ctx.run.brand, ctx.pageFetcher, ctx.now());
        ctx.rulings.push(...res.rulings.map((r) => ({ ...r, regulator: adapter.id })));
        ctx.regulatorPossible.push(...res.possible);
        return { signals: res.signals, could_not_check: [coverage, ...res.could_not_check], progress: res.progress };
      } catch (err) {
        if (!(err instanceof RegulatorUnavailableError)) throw err;
        return { signals: [], could_not_check: [coverage, couldNotCheck.regulatorSkipped(adapter.name, err.message)], skipped: { step: label, reason: err.message } };
      }
    },
  };
}

export const asaStep = makeRegulatorStep(asaUk, steps.asa);
export const jdpStep = makeRegulatorStep(jdpFr, steps.jdp);
