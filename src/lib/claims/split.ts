import { ABBREVIATIONS } from "./lexicon";

const ABBR = new Set<string>(ABBREVIATIONS);
/** Sentence-ending punctuation, optional closing quotes/brackets, then whitespace. */
const BOUNDARY = /[.!?…]+["”’»)\]]*\s+/gu;

function endsWithAbbreviation(before: string): boolean {
  const m = /(?:^|[\s("“‘])([\p{L}.]+)\.$/u.exec(before);
  if (!m) return false;
  const word = m[1].toLowerCase();
  if (ABBR.has(word)) return true;
  // A single capital initial ("J. Smith") or a dotted acronym ("U.S.").
  return /^\p{Lu}$/u.test(m[1]) || /^(\p{L}\.)+\p{L}$/u.test(m[1]);
}

/**
 * Deterministic sentence splitter. Lines (block elements from visibleText) are
 * always separate; within a line, a sentence ends at . ! ? or … followed by
 * whitespace and a character that is not a lowercase letter, unless the full
 * stop closes a known abbreviation or an initial.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    let start = 0;
    for (const m of line.matchAll(BOUNDARY)) {
      const end = m.index + m[0].length;
      const next = line.slice(end, end + 1);
      if (!next || /\p{Ll}/u.test(next)) continue;
      const punct = m[0].trimEnd();
      if (punct === "." && endsWithAbbreviation(line.slice(start, m.index + 1))) continue;
      const sentence = line.slice(start, end).trim();
      if (sentence) out.push(sentence);
      start = end;
    }
    const rest = line.slice(start).trim();
    if (rest) out.push(rest);
  }
  return out;
}
