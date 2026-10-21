// Item-wise validation of LLM outputs (brief Section 5: validate every output
// against the schema and drop invalid items; PLAN criterion 7.1).

import type { z } from "zod";

export type ItemsResult<T> =
  | { ok: true; items: T[]; dropped: { item: unknown; reason: string }[] }
  | { ok: false; reason: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The payload must be an object whose only key is `key`, holding an array.
 * Anything else is an invalid payload. Each array item is parsed with the
 * strict item schema; an item with an extra field or a wrong type is dropped.
 */
export function validateItems<T>(output: unknown, key: string, item: z.ZodType<T>): ItemsResult<T> {
  if (!isPlainObject(output)) return { ok: false, reason: "the output is not an object" };
  const extra = Object.keys(output).filter((k) => k !== key);
  if (extra.length > 0) return { ok: false, reason: `unexpected field ${extra.map((k) => `“${k}”`).join(", ")}` };
  const list = output[key];
  if (!Array.isArray(list)) return { ok: false, reason: `“${key}” is not a list` };
  const items: T[] = [];
  const dropped: { item: unknown; reason: string }[] = [];
  for (const raw of list) {
    const r = item.safeParse(raw);
    if (r.success) items.push(r.data);
    else dropped.push({ item: raw, reason: r.error.issues.map((i) => i.message).join("; ") });
  }
  return { ok: true, items, dropped };
}

/** A whole-object output (classification, summary): strict parse or invalid. */
export function validateObject<T>(output: unknown, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; reason: string } {
  const r = schema.safeParse(output);
  return r.success ? { ok: true, value: r.data } : { ok: false, reason: r.error.issues.map((i) => i.message).join("; ") };
}

/** Whitespace-insensitive form used for the verbatim-substring check. */
export const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** URLs written in a text (http and https), without trailing punctuation. */
export function urlsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'()\]]+/giu)) out.push(m[0].replace(/[.,;:!?…]+$/u, ""));
  return out;
}

/** Text words (for the summary length limit). */
export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/u).length : 0);
