import { ABSOLUTE } from "../lexicon";
import { has, phraseRegex, spansOf } from "./common";
import type { ClaimRule } from "./types";

const PHRASES = phraseRegex(ABSOLUTE.phrases);
const ZERO_WASTE = phraseRegex([ABSOLUTE.zeroWaste]);
const QUALIFIED = phraseRegex(ABSOLUTE.zeroWasteQualifiers.map((q) => q.replace(/ /g, "\\s+")));

export const absoluteRule: ClaimRule = {
  id: "absolute",
  family: "absolute",
  description:
    "Absolute claims that admit no impact at all: zero impact, impact-free, 100% / fully / completely sustainable or natural, the most sustainable, and \"zero waste\" when it is not qualified (for example \"zero waste to landfill\").",
  test(sentence) {
    const spans = spansOf(PHRASES, sentence);
    if (!has(QUALIFIED, sentence)) spans.push(...spansOf(ZERO_WASTE, sentence));
    spans.sort((a, b) => a[0] - b[0]);
    if (spans.length === 0) return null;
    return { ruleId: "absolute", phrase: sentence.slice(spans[0][0], spans[0][1]), spans };
  },
};
