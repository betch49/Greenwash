// ADR-033 (Phase 14): a ruling naming the brand scores on the track axis only when its
// topic is environmental. The lexicon lives in config/regulators.json, not here.
import config from "../../../config/regulators.json";
import type { Ruling } from "./adapter";

export interface TopicLexicon {
  terms: string[];
}

export const ENVIRONMENTAL_TOPIC: TopicLexicon = config.environmentalTopic;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One term ⇒ a whole-word regex; a trailing `*` matches any word ending ("sustainab*" ⇒ sustainable, sustainability). Unicode-aware (é, ç). */
export function termPattern(term: string): RegExp {
  const prefix = term.endsWith("*");
  const body = escape((prefix ? term.slice(0, -1) : term).toLowerCase()).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}${prefix ? "[\\p{L}\\p{N}-]*" : "(?![\\p{L}\\p{N}])"}`, "iu");
}

/** The lexicon terms found in a text (whole words), in lexicon order. */
export function environmentalTerms(text: string, lexicon: TopicLexicon = ENVIRONMENTAL_TOPIC): string[] {
  const t = text.toLowerCase();
  return lexicon.terms.filter((term) => termPattern(term).test(t));
}

export type TopicVerdict = { environmental: true; how: "topic_line" | "lexicon"; terms: string[] } | { environmental: false; how: "topic_line" | "lexicon"; terms: [] };

/**
 * Is the ruling's topic environmental? The regulator's own topic line decides when the
 * page publishes one; else the lexicon against the title and the fetched text.
 */
export function rulingTopic(ruling: Pick<Ruling, "title" | "text" | "topic">, lexicon: TopicLexicon = ENVIRONMENTAL_TOPIC): TopicVerdict {
  if (ruling.topic) {
    const terms = environmentalTerms(ruling.topic, lexicon);
    return terms.length ? { environmental: true, how: "topic_line", terms } : { environmental: false, how: "topic_line", terms: [] };
  }
  const terms = environmentalTerms(`${ruling.title}\n${ruling.text ?? ""}`, lexicon);
  return terms.length ? { environmental: true, how: "lexicon", terms } : { environmental: false, how: "lexicon", terms: [] };
}
