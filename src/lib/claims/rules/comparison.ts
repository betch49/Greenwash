import { COMPARISON } from "../lexicon";
import { PERCENT, YEAR, has, phraseRegex, spansOf } from "./common";
import type { ClaimRule } from "./types";

const PHRASES = phraseRegex(COMPARISON.phrases);
const BASELINE = phraseRegex(COMPARISON.baselineCues);

export const comparisonRule: ClaimRule = {
  id: "baseline_less_comparison",
  family: "baseline-less comparison",
  description:
    "Comparisons with nothing to compare against: more sustainable, greener, less plastic, lower impact, better for the planet… when the sentence has no \"than\" (or compared with / versus / baseline), no percentage and no year.",
  test(sentence) {
    const spans = spansOf(PHRASES, sentence);
    if (spans.length === 0) return null;
    if (has(BASELINE, sentence) || has(PERCENT, sentence) || has(YEAR, sentence)) return null;
    return { ruleId: "baseline_less_comparison", phrase: sentence.slice(spans[0][0], spans[0][1]), spans };
  },
};
