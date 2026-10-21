import config from "../../../config/wikidata.json";
import type { WikidataEntity } from "./entities";

export interface Candidate {
  id: string;
  name: string;
  description?: string;
  website?: string;
  /** Website host without "www.", e.g. "patagonia.com". */
  websiteHost?: string;
  industry?: string;
  country?: string;
  parent?: string;
  logo?: string;
  exactName: boolean;
  score: number;
  /** ISIN (P946) / LEI (P1278), when Wikidata has them (Phase 11, SBTi matching). */
  isins?: string[];
  leis?: string[];
}

export interface RankResult {
  /** Set only when one candidate scores clearly above the rest (brief Section 3.2). */
  confident: Candidate | null;
  /** Up to `maxCandidates` brand/company/organisation items, best first. */
  candidates: Candidate[];
}

const legalSuffixes = new Set(config.legalSuffixes);

/** Lowercase, strip diacritics, punctuation and trailing legal suffixes ("Patagonia, Inc." → "patagonia"). */
export function normaliseName(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && legalSuffixes.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

export function websiteHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

const companyIds = new Set(Object.keys(config.companyClassIds));
const denyIds = new Set(Object.keys(config.denyClassIds));

/** Instance of a brand/company/organisation class, or of a direct subclass of one. */
export function isCompanyLike(e: WikidataEntity): boolean {
  const denied = e.instanceOf.some(
    (c) => denyIds.has(c.id) || config.denyLabelWords.some((w) => c.label.toLowerCase().includes(w)),
  );
  if (denied) return false;
  return e.instanceOf.some((c) => companyIds.has(c.id) || (e.classParents[c.id] ?? []).some((p) => companyIds.has(p)));
}

export function toCandidate(query: string, e: WikidataEntity): Candidate {
  const q = normaliseName(query);
  const exactName = [e.label, ...e.aliases].some((n) => normaliseName(n) === q);
  const s = config.score;
  return {
    id: e.id,
    name: e.label,
    description: e.description,
    website: e.website,
    websiteHost: websiteHost(e.website),
    industry: e.industries[0]?.label,
    country: e.countries[0]?.label,
    parent: e.parent?.label,
    logo: e.logo,
    exactName,
    score: (exactName ? s.exactName : 0) + (e.website ? s.website : 0) + s.companyClass,
    ...(e.isins ? { isins: e.isins } : {}),
    ...(e.leis ? { leis: e.leis } : {}),
  };
}

/**
 * Brief rule: exact-name match + has website + is a brand/company/organisation ⇒ confident,
 * provided no other eligible item also meets all three. Otherwise up to three candidates.
 */
export function rankCandidates(query: string, entities: WikidataEntity[]): RankResult {
  const eligible = entities
    .filter(isCompanyLike)
    .map((e, i) => ({ c: toCandidate(query, e), i }))
    .sort((a, b) => b.c.score - a.c.score || a.i - b.i)
    .map((x) => x.c);
  const strong = eligible.filter((c) => c.exactName && c.website);
  if (strong.length === 1) return { confident: strong[0], candidates: [strong[0]] };
  return { confident: null, candidates: eligible.slice(0, config.maxCandidates) };
}
