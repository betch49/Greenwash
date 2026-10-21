// The three LLM-assisted steps (PLAN Phase 7 deliverable 6). Each one has a
// "skipped: LLM unavailable (<why>)" path, and a call that fails or returns an
// invalid payload leaves the rule-based result as it was (shown as a skipped
// line, never a throw). No step here produces a number that enters the score.

import { couldNotCheck, reasons, steps } from "../../copy/wording";
import type { ProgressEntry } from "../../db/runs-repo";
import { isSustainabilityPath } from "../../discover/heuristics";
import type { FetchedPage } from "../../discover/fetch-pages";
import { excerptOf } from "../../claims/engine";
import { applyClassification, classifyDiff } from "../../llm/classify-diff";
import { LLM_CONFIG, type LlmConfig } from "../../llm/config";
import { extractClaims } from "../../llm/extract";
import { summarise } from "../../llm/summary";
import type { LLMClient } from "../../llm/client";
import type { ReportV1 } from "../../score/report";
import { normaliseSentence } from "../../wayback/diff";
import type { Signal } from "../signal";
import type { PipelineContext, Step, StepResult } from "../types";

/** The reason the LLM steps cannot run, or null. */
export const llmUnavailable = (llm: LLMClient | null | undefined): string | null => (!llm ? reasons.noLlmClient : llm.unavailable);

const unavailableResult = (label: string, why: string): StepResult => ({
  signals: [],
  could_not_check: [couldNotCheck.llmSkipped(why)],
  skipped: { step: label, reason: reasons.llmUnavailable(why) },
});

/** Pages the extractor reads: sustainability-type pages first, then the rest, in fetch order, at most `extract.maxPages`. */
export function extractionPages(ctx: Pick<PipelineContext, "pages" | "config">, config: LlmConfig = LLM_CONFIG): FetchedPage[] {
  const sus = ctx.pages.filter((p) => isSustainabilityPath(p.url, ctx.config));
  const rest = ctx.pages.filter((p) => !sus.includes(p));
  return [...sus, ...rest].slice(0, config.extract.maxPages);
}

export function makeLlmExtractStep(config: LlmConfig = LLM_CONFIG): Step {
  return {
    id: "llm-extract",
    label: () => steps.llmExtract,
    async run(ctx): Promise<StepResult> {
      const why = llmUnavailable(ctx.llm);
      if (why) return unavailableResult(steps.llmExtract, why);
      const pages = extractionPages(ctx, config);
      if (pages.length === 0) return { signals: [], could_not_check: [], skipped: { step: steps.llmExtract, reason: reasons.llmNoPages } };
      const allowedUrls = ctx.pages.map((p) => p.url);
      const acceptedKeys = new Set<string>();
      const signals: Signal[] = [];
      const progress: ProgressEntry[] = [];
      let failed = 0;
      for (const page of pages) {
        const out = await extractClaims(ctx.llm!, page, { brand: ctx.run.brand, allowedUrls, ruleHits: ctx.claimHits, acceptedKeys, config });
        ctx.llmCalls.push(out.log);
        signals.push(...out.signals);
        if (out.problem) {
          if (out.log.status === "error") failed++;
          const what = steps.fetchPage(page.url);
          progress.push({ step: steps.llmExtract, status: "skipped", reason: out.log.status === "error" ? reasons.llmFailed(what, out.problem) : reasons.llmInvalid(what, out.problem) });
        }
      }
      if (failed === pages.length) return { signals, could_not_check: [], progress: progress.slice(1), skipped: { step: steps.llmExtract, reason: progress[0].reason! } };
      return { signals, could_not_check: [], progress };
    },
  };
}

export function makeLlmClassifyStep(config: LlmConfig = LLM_CONFIG): Step {
  return {
    id: "llm-classify",
    label: () => steps.llmClassify,
    async run(ctx): Promise<StepResult> {
      const why = llmUnavailable(ctx.llm);
      if (why) return unavailableResult(steps.llmClassify, why);
      const candidates = ctx.diffCandidates.slice(0, config.classify.maxCandidates);
      if (candidates.length === 0) return { signals: [], could_not_check: [], skipped: { step: steps.llmClassify, reason: reasons.llmNoCandidates } };
      const remove: string[] = [];
      const replace: Signal[] = [];
      const progress: ProgressEntry[] = [];
      let failed = 0;
      for (const c of candidates) {
        const signal = ctx.signals.find((s) => s.id === c.signalId);
        if (!signal) continue;
        const out = await classifyDiff(ctx.llm!, c);
        ctx.llmCalls.push(out.log);
        if (out.problem) {
          if (out.log.status === "error") failed++;
          const what = excerptOf(c.sentence, 0);
          progress.push({ step: steps.llmClassify, status: "skipped", reason: out.log.status === "error" ? reasons.llmFailed(what, out.problem) : reasons.llmInvalid(what, out.problem) });
          continue;
        }
        const d = applyClassification(signal, out.classification);
        if (out.classification) c.classification = out.classification;
        if (d.action === "keep") replace.push(d.signal);
        if (d.action === "drop") {
          remove.push(signal.id);
          // The timeline must not keep saying "claim removed" for a change classified as a redesign or a move.
          const key = normaliseSentence(excerptOf(c.sentence, 0));
          for (const t of ctx.timeline) {
            if (t.page_url === c.pageUrl && t.snapshot_url === c.to.snapshotUrl) t.claims_removed = t.claims_removed.filter((x) => normaliseSentence(x) !== key);
          }
        }
      }
      const patch = { remove, replace };
      if (failed > 0 && failed === candidates.length) return { signals: [], could_not_check: [], patch, progress: progress.slice(1), skipped: { step: steps.llmClassify, reason: progress[0].reason! } };
      return { signals: [], could_not_check: [], patch, progress };
    },
  };
}

export const llmExtractStep = makeLlmExtractStep();
export const llmClassifyStep = makeLlmClassifyStep();

/**
 * The summary, after scoring. Returns the progress line and the summary to attach
 * (absent ⇒ the UI shows "Summary unavailable").
 */
export async function summaryStep(llm: LLMClient | null | undefined, report: ReportV1, pageUrls: string[], log: PipelineContext["llmCalls"]): Promise<{ entry: ProgressEntry; summary?: ReportV1["summary"] }> {
  const why = llmUnavailable(llm);
  if (why) return { entry: { step: steps.llmSummary, status: "skipped", reason: reasons.llmUnavailable(why) } };
  const out = await summarise(llm!, report, pageUrls);
  log.push(out.log);
  if (out.summary) return { entry: { step: steps.llmSummary, status: "done" }, summary: out.summary };
  const reason = out.problem
    ? out.log.status === "error"
      ? reasons.llmFailed(steps.llmSummary, out.problem)
      : reasons.llmInvalid(steps.llmSummary, out.problem)
    : reasons.llmNoAnswer(steps.llmSummary);
  return { entry: { step: steps.llmSummary, status: "skipped", reason } };
}
