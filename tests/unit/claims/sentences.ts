// The 20 documented sentences of acceptance criterion 3.1: four per rule
// family, three that must match exactly that rule and one near miss that must
// match nothing. `next` is the sentence that follows on the page, when the
// rule looks at it. Mirrored in docs/METHODOLOGY.md.
import type { RuleId } from "@/lib/claims/rules";

export interface DocumentedSentence {
  family: string;
  sentence: string;
  next?: string;
  expected: RuleId | null;
  why: string;
}

export const SENTENCES: DocumentedSentence[] = [
  // vague
  { family: "vague", sentence: "Our jackets are made with eco-friendly materials.", expected: "vague", why: "eco-friendly" },
  { family: "vague", sentence: "Every bottle is responsibly made in Sweden.", expected: "vague", why: "responsibly made" },
  { family: "vague", sentence: "We are a sustainable company.", expected: "vague", why: "sustainable, bare" },
  { family: "vague", sentence: "We report against the Sustainable Development Goals.", expected: null, why: "a proper name, not a claim" },
  // absolute
  { family: "absolute", sentence: "Our packaging is 100% sustainable.", expected: "absolute", why: "100% sustainable" },
  { family: "absolute", sentence: "This jacket has zero impact on the planet.", expected: "absolute", why: "zero impact" },
  { family: "absolute", sentence: "We are a zero waste company.", expected: "absolute", why: "zero waste, bare" },
  { family: "absolute", sentence: "Our factory sends zero waste to landfill.", expected: null, why: "zero waste qualified by 'to landfill'" },
  // offset
  { family: "offset", sentence: "We are carbon neutral.", expected: "offset", why: "present-tense neutrality, no figure" },
  { family: "offset", sentence: "Our products are climate neutral.", next: "Learn how we got there.", expected: "offset", why: "next sentence has no reduction figure" },
  { family: "offset", sentence: "Our stores are net zero today.", expected: "offset", why: "net zero in the present tense" },
  {
    family: "offset",
    sentence: "Carbon neutral since 2020: we cut scope 1–2 emissions by 41% (see our 2024 report).",
    expected: null,
    why: "a reduction figure (cut … 41%) in the same sentence",
  },
  // baseline-less comparison
  { family: "baseline-less comparison", sentence: "Our new shell fabric is more sustainable.", expected: "baseline_less_comparison", why: "more sustainable, no baseline" },
  { family: "baseline-less comparison", sentence: "Longer device lifespans are better for the planet.", expected: "baseline_less_comparison", why: "better for the planet" },
  { family: "baseline-less comparison", sentence: "The new bottle uses less plastic.", expected: "baseline_less_comparison", why: "less plastic" },
  { family: "baseline-less comparison", sentence: "The new bottle uses 30% less plastic than the old one.", expected: null, why: "has 'than' and a percentage" },
  // future-only
  { family: "future-only", sentence: "We will be net zero by 2040.", expected: "future_only", why: "a target, no progress figure" },
  { family: "future-only", sentence: "We aim to halve our packaging waste.", expected: "future_only", why: "aim to" },
  { family: "future-only", sentence: "We are committed to 100% renewable electricity.", expected: "future_only", why: "committed to; 100% is the target, not progress" },
  {
    family: "future-only",
    sentence: "We aim to cut emissions in half by 2030.",
    next: "Since 2019 we have cut them by 24%.",
    expected: null,
    why: "the next sentence gives a progress figure",
  },
];
