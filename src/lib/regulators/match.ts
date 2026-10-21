// Conservative entity matching between a brand and a ruled entity (ADR-003).
// A ruling is attached to the brand's score only when the ruled entity's name
// IS the brand's name (legal suffixes and geographic qualifiers aside); a name
// that merely contains the brand is shown as a possible match and never scored.
import regulators from "../../../config/regulators.json";
import wikidata from "../../../config/wikidata.json";

export type MatchKind = "scored" | "possible" | "none";

const LEGAL = new Set(wikidata.legalSuffixes);
/** Qualifiers as token lists, longest first ("united kingdom" before "kingdom"-free singles). */
const QUALIFIERS = regulators.nameQualifiers.map((q) => q.split(" ")).sort((a, b) => b.length - a.length);
const TRADING_AS = new RegExp(`\\s(?:${regulators.tradingAs.map((t) => t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&").replace(/ /g, "\\s*")).join("|")})\\s`, "iu");

/** Lowercase, no diacritics, "&" ⇒ "and", dots dropped, every other non-alphanumeric run ⇒ one space. */
export function tokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The comparable core of a company name: tokens with trailing legal suffixes
 * (Inc, Ltd, SA, GmbH, BV, AB, …; config/wikidata.json) and trailing geographic or
 * structural qualifiers (UK, Europe, International, Holdings, …; config/regulators.json)
 * removed, repeatedly. "Oatly UK Ltd" ⇒ "oatly"; "Shell Energy UK" ⇒ "shell energy".
 * At least one token is always kept.
 */
export function normaliseEntity(name: string): string {
  const t = tokens(name);
  for (;;) {
    if (t.length > 1 && LEGAL.has(t[t.length - 1])) {
      t.pop();
      continue;
    }
    const q = QUALIFIERS.find((q) => t.length > q.length && q.every((w, i) => t[t.length - q.length + i] === w));
    if (q) {
      t.splice(t.length - q.length, q.length);
      continue;
    }
    break;
  }
  return t.join(" ");
}

/** "Oatly UK Ltd t/a Oatly" ⇒ ["Oatly UK Ltd", "Oatly"]: every name the ruled entity goes by. */
export function entityNames(advertiser: string): string[] {
  return ` ${advertiser} `
    .split(TRADING_AS)
    .map((s) => s.trim())
    .filter(Boolean);
}

const compact = (s: string) => s.replace(/ /g, "");
const wholeWord = (needle: string, hay: string) => needle.length > 0 && ` ${hay} `.includes(` ${needle} `);

/**
 * scored   — one of the advertiser's names (or the title, when the page has no advertiser
 *            field) equals the brand once both are normalised; spacing is ignored
 *            ("TOTAL ENERGIES" ≡ "TotalEnergies").
 * possible — the normalised brand is a whole word of the title or the advertiser, but some
 *            other word is part of the name ("Patagonia Provisions Ltd", "Shell Energy Retail").
 * none     — not even a whole-word occurrence ("Pata" in "Patagonia").
 */
export function matchEntity(brand: string, ruled: { title: string; advertiser?: string }): MatchKind {
  const b = normaliseEntity(brand);
  if (!b) return "none";
  const named = ruled.advertiser?.trim() ? ruled.advertiser : ruled.title;
  if (entityNames(named).some((n) => normaliseEntity(n) === b || compact(normaliseEntity(n)) === compact(b))) return "scored";
  const fields = [ruled.title, ruled.advertiser ?? ""].map((f) => tokens(f).join(" "));
  if (fields.some((f) => wholeWord(b, f))) return "possible";
  return "none";
}

/** The query sent to a regulator's search box: the brand without legal suffix ("Oatly AB" ⇒ "Oatly"). */
export function searchQuery(brand: string): string {
  const words = brand.trim().split(/\s+/);
  while (words.length > 1 && LEGAL.has(tokens(words[words.length - 1]).join(""))) words.pop();
  return words.join(" ").replace(/[,.]+$/, "");
}
