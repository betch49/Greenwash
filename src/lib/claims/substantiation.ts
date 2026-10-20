import type { PageLink } from "../discover/visible-text";
import { CERTIFIERS, SUBSTANTIATION } from "./lexicon";
import { NUMBER_UNIT, YEAR, phraseRegex, spansOf } from "./rules/common";
import { futureRule } from "./rules/future";
import type { RuleId, Span } from "./rules/types";

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
const TARGET_BEFORE = new RegExp(
  `(?:^|[^\\p{L}\\p{N}])(?:${SUBSTANTIATION.targetPrepositions.map((p) => p.replace(/ /g, "\\s+")).join("|")})\\s+(?:the\\s+(?:end\\s+of\\s+)?)?$`,
  "iu",
);

export interface SubstantiationOptions {
  /** The rule that matched: a future_only hit's own figures are its target (ADR-014). */
  ruleId?: RuleId;
  /** The run's brand name, so window sentences are classified as the engine does. */
  brand?: string;
}

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
 * Same-page substantiation (H, ADR-014): looks in the matched sentence (minus
 * the claim's own wording) and the following two sentences for a number with
 * a unit, a named standard or certifier, or a content link whose text appears
 * in the window and reads like evidence (report, data, methodology, footnote,
 * study, assessment). Targets are not evidence:
 * - a year is never a marker alone; it is recorded only next to a number +
 *   unit in the same sentence, and never after by/until/before/towards…;
 * - a window sentence that matches the future_only rule contributes nothing
 *   (for a non-future hit this includes the matched sentence itself);
 * - for a future_only hit, its own sentence contributes no number + unit.
 */
export function findSubstantiation(
  sentences: string[],
  index: number,
  spans: Span[],
  links: PageLink[] = [],
  opts: SubstantiationOptions = {},
): Substantiation {
  const markers: Marker[] = [];
  const window = sentences.slice(index, index + 1 + SUBSTANTIATION.followingSentences);
  const evidenceLinks = links.filter(
    (l) => l.region === "content" && collapse(l.text).length >= MIN_ANCHOR_CHARS && ANCHOR_TEXT.test(l.text),
  );
  const ownFuture = opts.ruleId === "future_only";
  window.forEach((raw, offset) => {
    const isTarget = futureRule.test(raw, { next: sentences[index + offset + 1], brand: opts.brand }) !== null;
    if (isTarget && !(offset === 0 && ownFuture)) return;
    const s = offset === 0 ? mask(raw, spans) : raw;
    const found: Marker[] = [];
    const figures = offset === 0 && ownFuture ? [] : spansOf(NUMBER_UNIT, s);
    for (const [a, b] of figures) found.push({ kind: "number_unit", text: s.slice(a, b), offset });
    if (figures.length > 0) {
      for (const [a, b] of spansOf(YEAR, s)) {
        if (TARGET_BEFORE.test(s.slice(0, a))) continue;
        if (figures.some(([fa, fb]) => a >= fa && b <= fb)) continue;
        found.push({ kind: "year", text: s.slice(a, b), offset });
      }
    }
    for (const c of certifiersIn(s)) found.push({ kind: "certifier", text: c.text, offset });
    const lower = collapse(s);
    for (const l of evidenceLinks) {
      if (lower.includes(collapse(l.text))) found.push({ kind: "anchor", text: l.text, href: l.href, offset });
    }
    markers.push(...found);
  });
  return { supported: markers.some((m) => m.kind !== "year"), markers };
}
