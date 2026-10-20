// The forbidden-word list (ADR-008). Nothing the app shows, prompts or
// documents may use these words as a verdict about a brand. This file is the
// only place they are spelled out; tests/unit/copy/forbidden.test.ts skips it
// and scans every other string literal under src/ and docs/METHODOLOGY.md.

export interface ForbiddenHit {
  term: string;
  index: number;
  context: string;
}

/** Forbidden anywhere in UI copy, the summary prompt and the docs. */
export const FORBIDDEN_TERMS: readonly { term: string; pattern: RegExp }[] = [
  { term: "lies", pattern: /(?<![\p{L}])lies(?![\p{L}])/giu },
  { term: "lying", pattern: /(?<![\p{L}])lying(?![\p{L}])/giu },
  { term: "liar", pattern: /(?<![\p{L}])liars?(?![\p{L}])/giu },
  { term: "guilty", pattern: /(?<![\p{L}])guilty(?![\p{L}])/giu },
  { term: "illegal", pattern: /(?<![\p{L}])illegal(?:ly)?(?![\p{L}])/giu },
  { term: "non-compliant", pattern: /(?<![\p{L}])non[- ]?compliant(?![\p{L}])/giu },
  { term: "fraud", pattern: /(?<![\p{L}])fraud\p{L}*/giu },
  { term: "deceptive", pattern: /(?<![\p{L}])deceptive(?:ly)?(?![\p{L}])/giu },
  { term: "deceive", pattern: /(?<![\p{L}])deceiv\p{L}*/giu },
  // "greenwashing" as a verdict. Allowed: the product name (Greenwash Radar, GreenwashRadar user agent,
  // greenwash.db) and "greenwashing risk …".
  { term: "greenwashing (as a verdict)", pattern: /(?<![\p{L}])greenwash(?!radar)\p{L}*(?![\p{L}])(?![\s-]+(?:radar|risk)(?![\p{L}]))(?!\.db)/giu },
];

/** Every forbidden term in `text`, with a little context for the error message. */
export function findForbidden(text: string): ForbiddenHit[] {
  const hits: ForbiddenHit[] = [];
  for (const { term, pattern } of FORBIDDEN_TERMS) {
    pattern.lastIndex = 0;
    for (const m of text.matchAll(pattern)) {
      hits.push({ term, index: m.index, context: text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30) });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** True when `text` has no forbidden term (used by the LLM summary filter in Phase 7). */
export const passesWordingFilter = (text: string): boolean => findForbidden(text).length === 0;
