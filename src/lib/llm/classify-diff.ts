// LLM diff classification (PLAN Phase 7 deliverable 4; brief Section 4: the
// LLM classifies a diff as "claim removed" vs "redesign", and a human-readable
// rule caps its influence).
//
// The cap, in plain words (docs/METHODOLOGY.md Section 12):
//   1. The classifier only ever sees removals the deterministic detector found
//      (Phase 4). It can keep, halve or drop one; it can never add one.
//   2. redesign / moved ⇒ the removal is dropped (signal and timeline line).
//      claim_removed ⇒ kept, marked AI-assisted (llm_used: true).
//      unsure ⇒ kept, AI-assisted, weight_hint × llm.unsureWeightMultiplier
//      (config/weights.json).
//   3. A kept removal counts as AI points, so the 50% guard (ADR-007) bounds it.
//   4. No answer, an invalid answer or a failed call ⇒ the rule-based removal
//      stands unchanged (llm_used: false).

import { z } from "zod";
import { WEIGHTS, type Weights } from "../score/weights";
import type { Signal } from "../pipeline/signal";
import type { DiffCandidate } from "../wayback/retraction";
import type { LLMCallLog, LLMClient } from "./client";
import { validateObject } from "./validate";

export const CLASSIFICATIONS = ["claim_removed", "redesign", "moved", "unsure"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const ClassifyOutputSchema = z.strictObject({ classification: z.enum(CLASSIFICATIONS) });

export const CLASSIFY_INSTRUCTIONS = [
  "Task: a sentence that makes an environmental claim was present in an earlier copy of a web page and is missing from a later copy. Decide what the change most likely is, using only the two excerpts given.",
  "claim_removed: the claim itself is gone from the later copy; the rest of the page is broadly the same.",
  "redesign: the page was rebuilt or restructured and the same claim is still made in other words or another format.",
  "moved: the same claim still appears in the later copy, in another place.",
  "unsure: the excerpts do not let you tell.",
  "Return only the classification.",
].join("\n");

export interface ClassifyInput {
  removed_sentence: string;
  earlier_copy: { captured: string; before: string[]; after: string[] };
  later_copy: { captured: string; is_live_page: boolean; nearest_sentence: string | null; context: string[] };
}

const ts = (t: string) => (/^\d{8}/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : t);

/** The exact input sent for one candidate (also the fixture key). Only the excerpts, no URL. */
export function classifyInput(c: DiffCandidate): ClassifyInput {
  return {
    removed_sentence: c.sentence,
    earlier_copy: { captured: ts(c.from.timestamp), before: c.from.before, after: c.from.after },
    later_copy: { captured: ts(c.to.timestamp), is_live_page: c.to.live === true, nearest_sentence: c.to.nearest, context: c.to.context },
  };
}

export type Decision =
  | { action: "keep"; signal: Signal }
  | { action: "drop" }
  | { action: "unchanged" };

/** What one classification does to its rule-based signal (pure; 7.3). */
export function applyClassification(signal: Signal, classification: Classification | undefined, w: Weights = WEIGHTS): Decision {
  switch (classification) {
    case "redesign":
    case "moved":
      return { action: "drop" };
    case "claim_removed":
      return { action: "keep", signal: { ...signal, llm_used: true } };
    case "unsure":
      return { action: "keep", signal: { ...signal, llm_used: true, weight_hint: signal.weight_hint * w.llm.unsureWeightMultiplier } };
    default:
      return { action: "unchanged" };
  }
}

export interface ClassifyOutcome {
  classification?: Classification;
  log: LLMCallLog;
  problem?: string;
}

/** Calls the LLM for one candidate. Never throws. */
export async function classifyDiff(llm: LLMClient, candidate: DiffCandidate): Promise<ClassifyOutcome> {
  let res;
  try {
    res = await llm.call({ name: "classify-diff", instructions: CLASSIFY_INSTRUCTIONS, input: classifyInput(candidate), schema: ClassifyOutputSchema });
  } catch (err) {
    return { problem: err instanceof Error ? err.message : String(err), log: { name: "classify-diff", used_fixture: false, status: "error" } };
  }
  if (res.output === undefined) return { log: { name: "classify-diff", used_fixture: res.used_fixture, status: "empty" } };
  const v = validateObject(res.output, ClassifyOutputSchema);
  if (!v.ok) return { problem: v.reason, log: { name: "classify-diff", used_fixture: res.used_fixture, status: "invalid" } };
  return { classification: v.value.classification, log: { name: "classify-diff", used_fixture: res.used_fixture, status: "ok" } };
}
