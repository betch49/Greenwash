import { FUTURE } from "../lexicon";
import { figureWith, has, phraseRegex, spansOf } from "./common";
import type { ClaimRule } from "./types";

const PHRASES = phraseRegex(FUTURE.phrases);
const BY_YEAR = phraseRegex([FUTURE.byYear]);
const TOPIC = phraseRegex(FUTURE.topics);
const PROGRESS = phraseRegex(FUTURE.progressCues);
const SUBJECTS = phraseRegex(FUTURE.commitmentSubjects);
const SUFFIX = new RegExp(`(?:[\\s,]+(?:${FUTURE.brandSuffixes.join("|")})\\.?)+$`, "iu");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

/** The brand name as a subject cue: the full name and the name without legal suffixes. */
function brandRegex(brand: string | undefined): RegExp | null {
  const full = brand?.trim();
  if (!full) return null;
  const names = [...new Set([full, full.replace(SUFFIX, "").trim()].filter((n) => n.length >= 2))];
  return phraseRegex(names.map(escape));
}

export const futureRule: ClaimRule = {
  id: "future_only",
  family: "future-only",
  description:
    "Environmental commitments about the future (we will, by 20XX, aim to, committed to, our goal is…) with no progress figure (a number with a unit next to a word such as since, already, achieved, reduced or \"in 2024\") in the same sentence or the next one. When \"by 20XX\" is the only trigger, the sentence must also name who commits (we, our, us, the company, the brand).",
  test(sentence, ctx) {
    const commitments = spansOf(PHRASES, sentence);
    const years = spansOf(BY_YEAR, sentence);
    if (commitments.length === 0 && years.length === 0) return null;
    if (!has(TOPIC, sentence)) return null;
    if (commitments.length === 0) {
      const brand = brandRegex(ctx?.brand);
      if (!has(SUBJECTS, sentence) && !(brand && has(brand, sentence))) return null;
    }
    if (figureWith(PROGRESS, sentence) || figureWith(PROGRESS, ctx?.next)) return null;
    const spans = [...commitments, ...years].sort((a, b) => a[0] - b[0]);
    return { ruleId: "future_only", phrase: sentence.slice(spans[0][0], spans[0][1]), spans };
  },
};
