import { VAGUE } from "../lexicon";
import { inside, phraseRegex, spansOf } from "./common";
import type { ClaimRule, Span } from "./types";

const PHRASES = phraseRegex(VAGUE.phrases);
const BARE = phraseRegex([VAGUE.bareSustainable]);
const NOT_IN = phraseRegex(VAGUE.bareSustainableNotIn);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*");
const QUALIFIER_BEFORE = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${VAGUE.bareSustainableNotAfter.map(escape).join("|")})\\s+$`, "iu");

/** "sustainable" used bare: not qualified (more/most/fully/100%…) and not part of a proper name. */
function bareSustainable(sentence: string): Span[] {
  const names = spansOf(NOT_IN, sentence);
  return spansOf(BARE, sentence).filter((span) => !inside(span, names) && !QUALIFIER_BEFORE.test(sentence.slice(0, span[0])));
}

export const vagueRule: ClaimRule = {
  id: "vague",
  family: "vague",
  description:
    "Vague environmental wording with no defined meaning: eco-friendly, earth-friendly, green products, natural materials, conscious, responsibly made, clean, low-impact, or \"sustainable\" used bare.",
  test(sentence) {
    const spans = [...spansOf(PHRASES, sentence), ...bareSustainable(sentence)].sort((a, b) => a[0] - b[0]);
    if (spans.length === 0) return null;
    return { ruleId: "vague", phrase: sentence.slice(spans[0][0], spans[0][1]), spans };
  },
};
