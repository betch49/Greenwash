import { evaluateEvidence } from "../../claims/evidence-rules";
import { reasons, steps } from "../../copy/wording";
import type { Step } from "../types";

/** Evidence-axis page rules: report link, absolute emissions, supplier list; labels go to "could not check". */
export const evidenceStep: Step = {
  id: "evidence",
  label: () => steps.evidence,
  async run(ctx) {
    if (ctx.pages.length === 0) {
      return { signals: [], could_not_check: [], skipped: { step: steps.evidence, reason: reasons.noPagesToScan } };
    }
    const res = evaluateEvidence(ctx.pages);
    ctx.evidence = { labels_claimed: res.labels_claimed, reportLinks: res.reportLinks };
    return { signals: res.signals, could_not_check: res.could_not_check };
  },
};
