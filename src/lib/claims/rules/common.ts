import { SUBSTANTIATION } from "../lexicon";
import type { Span } from "./types";

const START = "(?<![\\p{L}\\p{N}])";
const END = "(?![\\p{L}\\p{N}])";

/** Compiles a list of phrase patterns into one global, word-bounded regex. */
export function phraseRegex(sources: readonly string[], caseSensitive = false): RegExp {
  return new RegExp(`${START}(?:${sources.join("|")})${END}`, caseSensitive ? "gu" : "giu");
}

/** All non-overlapping matches of a global regex as spans. */
export function spansOf(re: RegExp, s: string): Span[] {
  const out: Span[] = [];
  re.lastIndex = 0;
  for (const m of s.matchAll(re)) {
    if (m[0].length === 0) continue;
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

export const has = (re: RegExp, s: string | undefined): boolean => (s ? spansOf(re, s).length > 0 : false);

export const inside = (span: Span, outer: Span[]): boolean => outer.some(([a, b]) => span[0] >= a && span[1] <= b);

/** Number + unit (%, t, tCO2e, kg, kWh…). */
export const NUMBER_UNIT = phraseRegex([SUBSTANTIATION.numberUnit]);
/** A calendar year. */
export const YEAR = new RegExp(`(?<!\\d)${SUBSTANTIATION.year}(?!\\d)`, "gu");
/** A percentage. */
export const PERCENT = phraseRegex(["\\d+(?:[.,]\\d+)*\\s?(?:%|percent|per cent)"]);

/** Number + unit in a sentence that also contains one of `cues`. */
export function figureWith(cues: RegExp, sentence: string | undefined): boolean {
  return has(NUMBER_UNIT, sentence) && has(cues, sentence);
}
