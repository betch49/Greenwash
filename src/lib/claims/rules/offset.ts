import { OFFSET } from "../lexicon";
import { figureWith, has, inside, phraseRegex, spansOf } from "./common";
import type { ClaimRule } from "./types";

const PHRASES = phraseRegex(OFFSET.phrases);
const NOT_IN = phraseRegex(OFFSET.notIn);
const FUTURE = phraseRegex(OFFSET.futureCues);
const REDUCTION = phraseRegex(OFFSET.reductionVerbs);

export const offsetRule: ClaimRule = {
  id: "offset",
  family: "offset",
  description:
    "Neutrality claims in the present tense (carbon neutral, climate neutral, net zero, carbon positive…) with no reduction figure (a number with a unit next to a verb such as reduced, cut or fell) in the same sentence or the next one.",
  test(sentence, ctx) {
    const names = spansOf(NOT_IN, sentence);
    const spans = spansOf(PHRASES, sentence).filter((s) => !inside(s, names));
    if (spans.length === 0) return null;
    // A target ("net zero by 2040") is a future commitment, handled by the future-only rule.
    if (has(FUTURE, sentence)) return null;
    if (figureWith(REDUCTION, sentence) || figureWith(REDUCTION, ctx?.next)) return null;
    return { ruleId: "offset", phrase: sentence.slice(spans[0][0], spans[0][1]), spans };
  },
};
