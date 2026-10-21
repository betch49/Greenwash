// The LLM client interface (PLAN Phase 7 deliverable 1). Every call names a
// task, passes a JSON input and the zod schema of the expected output. The
// client returns the raw output; the task module validates it item by item
// (an invalid item is dropped, an invalid payload gives an empty result).

import { createHash } from "node:crypto";
import type { z } from "zod";

export type LLMCallName = "extract" | "classify-diff" | "summary";

export interface LLMRequest {
  name: LLMCallName;
  /** Task instructions (appended to the shared system prompt). */
  instructions: string;
  /** JSON-serialisable input; the only text the model may use. */
  input: unknown;
  /** Output schema; converted to the tool's JSON schema (strict). */
  schema: z.ZodType;
}

export interface LLMResponse {
  /** The raw output, or undefined when there is none (no fixture recorded, no tool call). */
  output: unknown;
  /** True when the output came from a recorded fixture file (MockLLM). */
  used_fixture: boolean;
}

export interface LLMClient {
  readonly kind: "anthropic" | "mock";
  /** Why LLM steps are skipped ("no API key"), or null when calls may run. */
  readonly unavailable: string | null;
  call(req: LLMRequest): Promise<LLMResponse>;
}

/** One logged LLM call (ReportV1.llm_calls, brief Section 4: log which steps used an LLM). */
export interface LLMCallLog {
  name: LLMCallName;
  used_fixture: boolean;
  /** ok: valid output used; empty: nothing returned; invalid: output failed validation; error: the call failed. */
  status: "ok" | "empty" | "invalid" | "error";
}

export class LLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMError";
  }
}

/** JSON with object keys sorted, so the same input always hashes the same. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/** sha1(input) as used in fixture file names (PLAN Phase 7 deliverable 2). */
export const inputHash = (input: unknown) => createHash("sha1").update(stableStringify(input)).digest("hex");

/** `<name>-<sha1(input).slice(0,12)>.json`. */
export const fixtureFileName = (name: LLMCallName, input: unknown) => `${name}-${inputHash(input).slice(0, 12)}.json`;

/**
 * The shared system prompt (brief Section 5): the model may use only the text
 * it is given and may never reference anything outside it.
 */
export const SYSTEM_PROMPT = [
  "You are one component of Greenwash Radar, a tool that lists evidence-backed greenwashing risk signals about a brand. A deterministic rule engine decides every number in the score; you never produce a score, a weight or a count.",
  "Use only the text inside <input>. Do not use outside knowledge about the brand, and never reference, invent or guess a source, page, URL, document or fact that is not in <input>. If <input> lists allowed URLs, you may mention only those URLs, exactly as written.",
  "Describe risk signals, never verdicts: do not state or imply wrongdoing, intent or any legal conclusion about the brand.",
  "Answer only by calling the provided tool once, with arguments that match its schema exactly.",
].join("\n");
