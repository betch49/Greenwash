import type { PageLink } from "../discover/visible-text";
import { CERTIFIERS, SUBSTANTIATION } from "./lexicon";
import { NUMBER_UNIT, YEAR, phraseRegex, spansOf } from "./rules/common";
import type { Span } from "./rules/types";

export type MarkerKind = "number_unit" | "year" | "certifier" | "anchor";

export interface Marker {
  kind: MarkerKind;
  /** The marker text, verbatim (for an anchor: its link text). */
  text: string;
  /** 0 = the matched sentence, 1 and 2 = the sentences after it. */
  offset: number;
  /** For an anchor: the link target. */
  href?: string;
}

export interface Substantiation {
  supported: boolean;
  markers: Marker[];
}

const CERTIFIER_RES = CERTIFIERS.map((c) => ({ name: c.name, re: phraseRegex([c.pattern], c.caseSensitive) }));
const ANCHOR_TEXT = new RegExp(SUBSTANTIATION.anchorText, "iu");
const MIN_ANCHOR_CHARS = 4;

/** Blanks out the claim's own trigger phrases: "100% sustainable" is not evidenced by its own "100%". */
export function mask(sentence: string, spans: Span[]): string {
  let out = sentence;
  for (const [a, b] of spans) out = out.slice(0, a) + " ".repeat(b - a) + out.slice(b);
  return out;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Named standards and certifiers mentioned in a text. */
export function certifiersIn(text: string): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  for (const c of CERTIFIER_RES) {
    for (const [a, b] of spansOf(c.re, text)) out.push({ name: c.name, text: text.slice(a, b) });
  }
  return out;
}

/**
 * Same-page substantiation (H): looks in the matched sentence (minus the
 * claim's own wording) and the following two sentences for a number with a
 * unit, a year, a named standard or certifier, or a content link whose text
 * appears in the window and reads like evidence (report, data, methodology,
 * footnote, study, assessment).
 */
export function findSubstantiation(sentences: string[], index: number, spans: Span[], links: PageLink[] = []): Substantiation {
  const markers: Marker[] = [];
  const window = sentences.slice(index, index + 1 + SUBSTANTIATION.followingSentences);
  const evidenceLinks = links.filter(
    (l) => l.region === "content" && collapse(l.text).length >= MIN_ANCHOR_CHARS && ANCHOR_TEXT.test(l.text),
  );
  window.forEach((raw, offset) => {
    const s = offset === 0 ? mask(raw, spans) : raw;
    for (const [a, b] of spansOf(NUMBER_UNIT, s)) markers.push({ kind: "number_unit", text: s.slice(a, b), offset });
    for (const [a, b] of spansOf(YEAR, s)) markers.push({ kind: "year", text: s.slice(a, b), offset });
    for (const c of certifiersIn(s)) markers.push({ kind: "certifier", text: c.text, offset });
    const lower = collapse(s);
    for (const l of evidenceLinks) {
      if (lower.includes(collapse(l.text))) markers.push({ kind: "anchor", text: l.text, href: l.href, offset });
    }
  });
  return { supported: markers.length > 0, markers };
}
