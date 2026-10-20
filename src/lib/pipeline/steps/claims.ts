import { mergeStats, scanPage } from "../../claims/engine";
import { reasons, steps } from "../../copy/wording";
import type { Signal } from "../signal";
import type { Step } from "../types";

/** Claim-language engine (F) over every fetched page. Deterministic; llm_used is always false. */
export const claimsStep: Step = {
  id: "claims",
  label: () => steps.claims,
  async run(ctx) {
    if (ctx.pages.length === 0) {
      return { signals: [], could_not_check: [], skipped: { step: steps.claims, reason: reasons.noPagesToScan } };
    }
    const signals: Signal[] = [];
    const seen = new Set<string>();
    const stats = [];
    for (const page of ctx.pages) {
      const res = scanPage(page.text, { url: page.url, fetchedAt: page.fetchedAt, links: page.links, brand: ctx.run.brand });
      stats.push(res.stats);
      ctx.claimHits.push(...res.hits);
      // The same sentence on two pages (shared blocks, translations) gives one signal, from the first page.
      for (const s of res.signals) {
        const hit = res.hits.find((h) => h.signalId === s.id)!;
        const key = `${hit.ruleId} ${hit.sentence.toLowerCase().replace(/\s+/g, " ")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        signals.push(s);
      }
    }
    ctx.claimStats = mergeStats(stats);
    return { signals, could_not_check: [] };
  },
};
