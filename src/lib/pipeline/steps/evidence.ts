import { evaluateEvidence } from "../../claims/evidence-rules";
import { couldNotCheck, reasons, steps } from "../../copy/wording";
import { isSustainabilityPath } from "../../discover/heuristics";
import type { Step } from "../types";

/** Evidence kinds that state an absence: never emitted when the gap is ours (QA-3, Phase 14). */
const ABSENCE_KINDS = new Set(["evidence.no_report_found"]);

/**
 * Evidence-axis page rules: report link, absolute emissions, supplier list; labels go to "could not check".
 * QA-3 (Phase 14, brief Section 4 "missing data never increases the score"): when no fetched page is a
 * sustainability-type page, the absence kinds are not emitted; with nothing protective found either, the
 * step is skipped and the axis is "no data" (0 points, lower confidence) with a could-not-check line.
 */
export const evidenceStep: Step = {
  id: "evidence",
  label: () => steps.evidence,
  async run(ctx) {
    if (ctx.pages.length === 0) {
      return { signals: [], could_not_check: [], skipped: { step: steps.evidence, reason: reasons.noPagesToScan } };
    }
    const res = evaluateEvidence(ctx.pages);
    ctx.evidence = { labels_claimed: res.labels_claimed, reportLinks: res.reportLinks };
    if (ctx.pages.some((p) => isSustainabilityPath(p.url, ctx.config))) return { signals: res.signals, could_not_check: res.could_not_check };
    const signals = res.signals.filter((s) => !ABSENCE_KINDS.has(s.kind));
    const could_not_check = [...res.could_not_check, couldNotCheck.evidenceNotChecked];
    if (signals.length === 0) return { signals: [], could_not_check, skipped: { step: steps.evidence, reason: reasons.noSustainabilityPageForEvidence } };
    return { signals, could_not_check };
  },
};
