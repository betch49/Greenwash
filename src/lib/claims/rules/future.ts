import { FUTURE } from "../lexicon";
import { figureWith, has, phraseRegex, spansOf } from "./common";
import type { ClaimRule } from "./types";

const PHRASES = phraseRegex(FUTURE.phrases);
const TOPIC = phraseRegex(FUTURE.topics);
const PROGRESS = phraseRegex(FUTURE.progressCues);

export const futureRule: ClaimRule = {
  id: "future_only",
  family: "future-only",
  description:
    "Environmental commitments about the future (will, by 20XX, aim to, committed to, our goal is…) with no progress figure (a number with a unit next to a word such as since, already, achieved, reduced or \"in 2024\") in the same sentence or the next one.",
  test(sentence, ctx) {
    const spans = spansOf(PHRASES, sentence);
    if (spans.length === 0 || !has(TOPIC, sentence)) return null;
    if (figureWith(PROGRESS, sentence) || figureWith(PROGRESS, ctx?.next)) return null;
    return { ruleId: "future_only", phrase: sentence.slice(spans[0][0], spans[0][1]), spans };
  },
};
