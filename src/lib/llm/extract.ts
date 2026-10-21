// LLM claim extraction (PLAN Phase 7 deliverable 3; brief Section 4: the LLM
// may propose candidate claims, the rule engine decides).
//
// For one fetched page the model proposes claim sentences. Each proposal must
// be a verbatim substring of the page text (whitespace-insensitive), else it is
// dropped. The Phase 3 rules then re-scan it with the page's own context: no
// rule match ⇒ dropped. A proposal that overlaps a sentence the rules already
// found on their own adds nothing (the deterministic signal wins, llm_used
// false). Only a rule-confirmed sentence the rules had not found becomes a new
// signal with llm_used: true. These signals are never added to ClaimStats: the
// scorer adds their points on top of the rule-based counts, so they are counted
// once and show in ai_share (Phase 6 review carry-forward).

import { createHash } from "node:crypto";
import { z } from "zod";
import { classify, excerptOf, DEFAULT_WEIGHT_HINT, type ClaimHit } from "../claims/engine";
import { RULE_IDS, type RuleId } from "../claims/rules";
import { splitSentences } from "../claims/split";
import { findSubstantiation } from "../claims/substantiation";
import { claimFamilyNames, signalLabels } from "../copy/wording";
import type { FetchedPage } from "../discover/fetch-pages";
import type { Signal } from "../pipeline/signal";
import type { LLMCallLog, LLMClient } from "./client";
import { LLM_CONFIG, type LlmConfig } from "./config";
import { collapse, validateItems } from "./validate";

export const KIND_HINTS = [...RULE_IDS, "other"] as const;

export const ExtractItemSchema = z.strictObject({
  sentence: z.string().min(1),
  kind_hint: z.enum(KIND_HINTS as unknown as [string, ...string[]]),
});

export const ExtractOutputSchema = z.strictObject({ claims: z.array(ExtractItemSchema) });

export type ExtractItem = z.infer<typeof ExtractItemSchema>;

export const EXTRACT_INSTRUCTIONS = [
  "Task: list the sentences of the page text that make an environmental or sustainability claim about the brand, its products or its operations.",
  "Copy each sentence exactly as it appears in input.text, character for character; do not shorten, merge, translate or rephrase it.",
  `For kind_hint use one of: ${KIND_HINTS.join(", ")}.`,
  "List at most the claims you find; an empty list is a valid answer. Do not add any other field.",
].join("\n");

export interface ExtractInput {
  page_url: string;
  text: string;
  allowed_urls: string[];
}

/** The exact input sent for one page (also the fixture key). */
export function extractInput(page: Pick<FetchedPage, "url" | "text">, allowedUrls: string[], config: LlmConfig = LLM_CONFIG): ExtractInput {
  return { page_url: page.url, text: page.text.slice(0, config.extract.maxChars), allowed_urls: [...allowedUrls].sort() };
}

export type DropReason = "invalid item" | "not verbatim in the page text" | "no claim rule matches" | "duplicate";

export interface ExtractOutcome {
  /** New claim signals (llm_used: true), source_url = the page URL. */
  signals: Signal[];
  /** Proposals the rules had already found on their own (no new signal). */
  confirmed: string[];
  dropped: { sentence: string; reason: DropReason | string }[];
  log: LLMCallLog;
  /** Set when the whole payload was invalid or the call failed (shown as a skipped line). */
  problem?: string;
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const key = (s: string) => collapse(s).toLowerCase().replace(/[\s.!?…:;,]+$/u, "");

/** The smallest run of page sentences (at most `maxSpan`) whose joined text contains the proposal. */
function locate(sentences: string[], proposal: string, maxSpan = 3): { start: number; end: number } | null {
  const p = collapse(proposal);
  for (let span = 1; span <= maxSpan; span++) {
    for (let i = 0; i + span <= sentences.length; i++) {
      if (collapse(sentences.slice(i, i + span).join(" ")).includes(p)) return { start: i, end: i + span - 1 };
    }
  }
  return null;
}

/** True when a rule-found sentence and the proposal overlap (one contains the other). */
const overlaps = (a: string, b: string) => {
  const ka = key(a);
  const kb = key(b);
  return ka.includes(kb) || kb.includes(ka);
};

export interface ExtractContext {
  brand?: string;
  /** Every URL the pipeline fetched (the model may cite only these). */
  allowedUrls: string[];
  /** Rule hits over all pages (Phase 3 claims step). */
  ruleHits: Pick<ClaimHit, "sentence">[];
  /** Sentences already accepted from earlier pages' proposals. */
  acceptedKeys?: Set<string>;
  config?: LlmConfig;
}

/** Validates and applies one page's extraction output. Pure: no LLM call (tested on its own, 7.1/7.2). */
export function applyExtraction(output: unknown, page: Pick<FetchedPage, "url" | "text" | "links" | "fetchedAt">, ctx: ExtractContext): Omit<ExtractOutcome, "log"> & { valid: boolean } {
  const config = ctx.config ?? LLM_CONFIG;
  const out: Omit<ExtractOutcome, "log"> & { valid: boolean } = { signals: [], confirmed: [], dropped: [], valid: true };
  if (output === undefined) return out;
  const v = validateItems(output, "claims", ExtractItemSchema);
  if (!v.ok) return { ...out, valid: false, problem: v.reason };
  for (const d of v.dropped) out.dropped.push({ sentence: String((d.item as { sentence?: unknown })?.sentence ?? ""), reason: `invalid item (${d.reason})` });

  const text = collapse(page.text.slice(0, config.extract.maxChars));
  const sentences = splitSentences(page.text);
  const accepted = ctx.acceptedKeys ?? new Set<string>();
  for (const item of v.items.slice(0, config.extract.maxClaims)) {
    const sentence = collapse(item.sentence);
    if (!sentence || !text.includes(sentence)) {
      out.dropped.push({ sentence: item.sentence, reason: "not verbatim in the page text" });
      continue;
    }
    // The rule engine decides, with the same next-sentence and brand context as the page scan.
    const at = locate(sentences, sentence);
    const next = at ? sentences[at.end + 1] : undefined;
    const matches = classify(sentence, next, ctx.brand);
    if (matches.length === 0) {
      out.dropped.push({ sentence, reason: "no claim rule matches" });
      continue;
    }
    if (ctx.ruleHits.some((h) => overlaps(h.sentence, sentence))) {
      out.confirmed.push(sentence);
      continue;
    }
    const k = key(sentence);
    if (accepted.has(k)) {
      out.dropped.push({ sentence, reason: "duplicate" });
      continue;
    }
    accepted.add(k);
    const window = at ? [...sentences.slice(0, at.start), sentence, ...sentences.slice(at.end + 1)] : [sentence];
    const index = at ? at.start : 0;
    for (const m of matches) {
      const sub = findSubstantiation(window, index, m.spans, page.links ?? [], { ruleId: m.ruleId, brand: ctx.brand });
      const family = claimFamilyNames[m.ruleId as RuleId];
      out.signals.push({
        id: `llm-claim-${m.ruleId}-${hash(`${page.url} ${k}`)}`,
        axis: "claims",
        kind: sub.supported ? "claim.supported" : "claim.unsupported",
        label: sub.supported ? signalLabels.claimSupported(family) : signalLabels.claimUnsupported(family),
        weight_hint: DEFAULT_WEIGHT_HINT,
        // 7.2: the receipt is always the page the sentence came from, never a URL from the model.
        source_url: page.url,
        fetched_at: page.fetchedAt,
        excerpt: excerptOf(sentence, m.spans[0][0]),
        llm_used: true,
      });
    }
  }
  return out;
}

/** Calls the LLM for one page and applies the result. Never throws: a failed call is a `problem`. */
export async function extractClaims(llm: LLMClient, page: FetchedPage, ctx: ExtractContext): Promise<ExtractOutcome> {
  const config = ctx.config ?? LLM_CONFIG;
  const input = extractInput(page, ctx.allowedUrls, config);
  let res;
  try {
    res = await llm.call({ name: "extract", instructions: EXTRACT_INSTRUCTIONS, input, schema: ExtractOutputSchema });
  } catch (err) {
    return { signals: [], confirmed: [], dropped: [], problem: err instanceof Error ? err.message : String(err), log: { name: "extract", used_fixture: false, status: "error" } };
  }
  const applied = applyExtraction(res.output, page, ctx);
  const status = res.output === undefined ? "empty" : applied.valid ? "ok" : "invalid";
  return { signals: applied.signals, confirmed: applied.confirmed, dropped: applied.dropped, ...(applied.problem ? { problem: applied.problem } : {}), log: { name: "extract", used_fixture: res.used_fixture, status } };
}
