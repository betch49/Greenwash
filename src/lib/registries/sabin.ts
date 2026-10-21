// Sabin Center Climate Litigation Database adapter (PLAN Phase 13, ADR-028).
// The database lives on www.climatecasechart.com (a Climate Policy Radar app). Only
// two kinds of page are read, both server-rendered: /document/<slug> (one case
// family) and /geographies/<slug> (the 4 newest families of a country). The search
// results load client-side from a private API with the app's own token and
// robots.txt disallows /_search, so neither is ever requested (criterion 13.5).
// A filed case is not a ruling: the signal's points stay below a regulator ruling's.
import { createHash } from "node:crypto";
import config from "../../../config/registries.json";
import seed from "../../../fixtures/sources/sabin/index.json";
import { litigationWording as lw } from "../copy/wording";
import { FetchError, type FetchResult, type Fetcher } from "../fetch/fetcher";
import { RobotsDisallowedError } from "../fetch/robots";
import type { Signal } from "../pipeline/signal";
import { collapse, firstChars, RULING_EXCERPT_CHARS } from "../regulators/adapter";
import { matchEntity, normaliseEntity, tokens, type MatchKind } from "../regulators/match";
import { WEIGHTS, type Weights } from "../score/weights";

export const SABIN = config.sabin;

/** One case family to read: from a geography listing or from the recorded seed index. */
export interface CaseCandidate {
  url: string;
  /** Title as listed (geography pages); absent for seed entries, whose title is read from the page. */
  title?: string;
  via: "geography" | "seed";
}

/** A parsed /document/<slug> page. */
export interface Case {
  url: string;
  title: string;
  summary: string;
  /** Year of the "Filed" event, else of `published_date`; null when the page gives neither. */
  filed_year: number | null;
  /** ISO YYYY-MM-DD of the filing (year precision is common: "2022-01-01"). */
  filed_date: string | null;
  /** `metadata.status[0]` as published, or "unknown". */
  status: string;
  /** Newest event as published ("Decision (2025-10-23)"), or "unknown". */
  last_event: string;
  geographies: string[];
  parties_from_title: string[];
  fetchedAt: string;
}

/** The adapter shape (Phase 5 RegulatorAdapter's sibling for case databases). */
export interface CaseAdapter {
  id: "sabin";
  name: string;
  discover(brand: string, entity: unknown, fetcher: Fetcher): Promise<Discovery>;
  fetchCase(url: string, fetcher: Fetcher): Promise<Case>;
}

export interface Discovery {
  candidates: CaseCandidate[];
  /** Human-readable list of the countries whose listing was read ("France and the United States"). */
  countries: string;
  /** Country labels with no known geography slug (one could-not-check line each). */
  unknownCountries: string[];
  seedCount: number;
}

/** Site unreachable (5xx, network error, robots): the step is skipped with this message. */
export class SabinUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SabinUnavailableError";
  }
}

/** A page that answered 200 without the structure the parser knows. */
export class SabinParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SabinParseError";
  }
}

export interface SeedEntry {
  url: string;
  recorded_at: string;
  recorded_from: string;
}

/** The recorded seed index (fixtures/sources/sabin/index.json): URLs only, never trusted as a match. */
export const SEED_INDEX: SeedEntry[] = (seed as { entries: SeedEntry[] }).entries;

export const documentUrl = (slug: string) => `${SABIN.origin}${SABIN.documentPath}${slug}`;
export const geographyUrl = (slug: string) => `${SABIN.origin}${SABIN.geographyPath}${slug}`;

/** True for the only URLs this adapter may request (plus the origin's robots.txt, read by the guard). */
export function isAllowedSabinUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.origin !== SABIN.origin) return false;
  if (u.pathname === "/robots.txt") return true;
  return (u.pathname.startsWith(SABIN.documentPath) || u.pathname.startsWith(SABIN.geographyPath)) && u.search === "";
}

async function getPage(fetcher: Fetcher, url: string): Promise<FetchResult> {
  if (!isAllowedSabinUrl(url)) throw new Error(`refusing to request ${url}: only ${SABIN.documentPath} and ${SABIN.geographyPath} pages are read`);
  let res: FetchResult;
  try {
    res = await fetcher.get(url, { headers: { accept: "text/html" } });
  } catch (err) {
    if (err instanceof RobotsDisallowedError) throw new SabinUnavailableError(err.message);
    if (err instanceof FetchError) throw new SabinUnavailableError(lw.unreachable(err.status ? `HTTP ${err.status}` : err.message));
    throw new SabinUnavailableError(lw.unreachable(err instanceof Error ? err.message : String(err)));
  }
  if (res.status !== 200) throw new SabinUnavailableError(lw.unreachable(`HTTP ${res.status}`));
  return res;
}

/** The page's server-rendered `__NEXT_DATA__.props.pageProps`, or null. */
export function nextData(html: string): Record<string, unknown> | null {
  const m = /<script[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]) as { props?: { pageProps?: Record<string, unknown> } };
    return data.props?.pageProps ?? null;
  } catch {
    return null;
  }
}

interface RawEvent {
  date?: string;
  event_type?: string;
  title?: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const yearOf = (iso: string | null | undefined) => (iso && /^\d{4}/.test(iso) ? Number(iso.slice(0, 4)) : null);

/**
 * "Greenpeace France and Others v. TotalEnergies SE and TotalEnergies Electricité et Gaz France" ⇒ its parties,
 * verbatim. A parenthesised case nickname ("(No New Oil and Gas Fields Case)") is not a party and is dropped first.
 */
export function partiesFromTitle(title: string): string[] {
  return title
    .replace(/\s*\([^)]*\)/g, " ")
    .split(/\s+vs?\.?\s+|\s+et al\.?|,|\s+and\s+/iu)
    .map((p) => collapse(p).replace(/^[\s:;–—-]+|[\s:;–—-]+$/g, ""))
    .filter((p) => p.length > 0);
}

/** Parses a /document/<slug> page (criterion 13.1). */
export function parseCasePage(html: string, url: string, fetchedAt: string): Case {
  const props = nextData(html);
  const family = props?.family as Record<string, unknown> | undefined;
  const title = collapse(str(family?.title));
  if (!family || !title) throw new SabinParseError(lw.caseUnparsed(url));
  const events = (Array.isArray(family.events) ? (family.events as RawEvent[]) : []).filter((e) => str(e.date));
  const filed = events.filter((e) => /^filed$/i.test(str(e.event_type))).map((e) => str(e.date).slice(0, 10)).sort()[0];
  const published = str(family.published_date).slice(0, 10) || null;
  const filed_date = filed ?? published;
  const newest = [...events].sort((a, b) => str(b.date).localeCompare(str(a.date)))[0];
  const meta = (family.metadata ?? {}) as Record<string, unknown>;
  const statusList = Array.isArray(meta.status) ? (meta.status as unknown[]).map(str).filter(Boolean) : [];
  const geos = Array.isArray(family.geographies) ? (family.geographies as Record<string, unknown>[]).map((g) => str(g.value)).filter(Boolean) : [];
  return {
    url,
    title,
    summary: collapse(str(family.summary)),
    filed_year: yearOf(filed_date),
    filed_date,
    status: statusList[0] ?? "unknown",
    last_event: newest ? `${collapse(str(newest.title) || str(newest.event_type))} (${str(newest.date).slice(0, 10)})` : "unknown",
    geographies: geos,
    parties_from_title: partiesFromTitle(title),
    fetchedAt,
  };
}

export interface GeographyFamily {
  slug: string;
  title: string;
  url: string;
  date?: string;
}

/** Parses a /geographies/<slug> page: the families it server-renders (criterion 13.2). */
export function parseGeographyPage(html: string, url: string): GeographyFamily[] {
  const props = nextData(html);
  const results = props?.vespaSearchResults as { families?: Record<string, unknown>[] } | undefined;
  if (!results || !Array.isArray(results.families)) throw new SabinParseError(lw.geographyUnparsed(url));
  return results.families
    .map((f) => ({ slug: str(f.family_slug), title: collapse(str(f.family_name)), date: str(f.family_date).slice(0, 10) || undefined }))
    .filter((f) => /^[a-z0-9][a-z0-9_-]*$/i.test(f.slug) && f.title)
    .map((f) => ({ ...f, url: documentUrl(f.slug) }));
}

/** The brand's Wikidata P17 label (Phase 1 Candidate.country), if any. */
export function entityCountry(entity: unknown): string | undefined {
  if (!entity || typeof entity !== "object") return undefined;
  const c = (entity as { country?: unknown }).country;
  return typeof c === "string" && c.trim() ? c.trim() : undefined;
}

const SLUGS = SABIN.countrySlugs as Record<string, string>;

/**
 * scored   — one party named in the title equals the brand after the ADR-019 normalisation;
 * possible — the brand is a whole word of the title but no party is the brand;
 * none     — otherwise.
 */
export function matchCase(brand: string, title: string): { kind: MatchKind; party?: string } {
  const parties = partiesFromTitle(title);
  const scored = parties.find((p) => matchEntity(brand, { title: p }) === "scored");
  if (scored) return { kind: "scored", party: scored };
  const b = normaliseEntity(brand);
  const whole = (hay: string) => b.length > 0 && ` ${tokens(hay).join(" ")} `.includes(` ${b} `);
  if (whole(title)) return { kind: "possible", party: parties.find((p) => whole(p)) ?? title };
  return { kind: "none" };
}

const listJoin = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The geography pages read for a brand: its P17 country (when the site has a page we know) and the US. */
export function geographiesFor(entity: unknown): { slugs: { slug: string; label: string }[]; unknownCountries: string[] } {
  const country = entityCountry(entity);
  const slugs: { slug: string; label: string }[] = [];
  const unknownCountries: string[] = [];
  if (country) {
    const slug = SLUGS[country];
    if (slug && slug !== SABIN.usSlug) slugs.push({ slug, label: country });
    else if (!slug) unknownCountries.push(country);
  }
  slugs.push({ slug: SABIN.usSlug, label: SABIN.usLabel });
  return { slugs, unknownCountries };
}

/** The coverage sentence's country list ("France and the United States"). */
export const coverageCountries = (entity: unknown) => listJoin(geographiesFor(entity).slugs.map((s) => s.label));

export const sabin: CaseAdapter = {
  id: "sabin",
  name: "Sabin Center Climate Litigation Database",
  /**
   * PLAN Phase 13 deliverable 2: the brand's country page and the US page (only the families
   * they server-render), then every seed-index URL. A geography page that cannot be fetched
   * throws SabinUnavailableError (the step is skipped); one that cannot be parsed too.
   */
  async discover(brand, entity, fetcher) {
    const { slugs, unknownCountries } = geographiesFor(entity);
    const candidates: CaseCandidate[] = [];
    const seen = new Set<string>();
    for (const { slug } of slugs) {
      const url = geographyUrl(slug);
      const res = await getPage(fetcher, url);
      for (const f of parseGeographyPage(res.body, url)) {
        if (seen.has(f.url) || matchCase(brand, f.title).kind === "none") continue;
        seen.add(f.url);
        candidates.push({ url: f.url, title: f.title, via: "geography" });
      }
    }
    for (const e of SEED_INDEX) {
      if (seen.has(e.url) || !isAllowedSabinUrl(e.url)) continue;
      seen.add(e.url);
      candidates.push({ url: e.url, via: "seed" });
    }
    return { candidates, countries: listJoin(slugs.map((s) => s.label)), unknownCountries, seedCount: SEED_INDEX.length };
  },
  async fetchCase(url, fetcher) {
    const res = await getPage(fetcher, url);
    return parseCasePage(res.body, url, res.fetchedAt);
  },
};

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text: string, kw: string) => new RegExp(`(?<![\\p{L}])${escapeRe(kw)}(?![\\p{L}])`, "iu").test(text);

/** The configured multiplier for a status (else the last event; else `unknownMultiplier`). Criterion 13.4. */
export function statusMultiplier(c: Pick<Case, "status" | "last_event">, w: Weights["litigation"] = WEIGHTS.litigation): number {
  for (const text of [c.status, c.last_event]) {
    if (!text || text === "unknown") continue;
    const rule = w.statusMultipliers.find((r) => r.keywords.some((k) => hasWord(text, k)));
    if (rule) return rule.multiplier;
  }
  return w.unknownMultiplier;
}

/** weight_hint = baseHint × status multiplier × recentMultiplier when filed within recentYears (config/weights.json). */
export function caseWeightHint(c: Pick<Case, "status" | "last_event" | "filed_date">, now: Date, w: Weights = WEIGHTS): number {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - w.regulatorRuling.recentYears);
  const recent = c.filed_date !== null && Date.parse(`${c.filed_date}T00:00:00Z`) >= cutoff.getTime();
  return w.litigation.baseHint * statusMultiplier(c, w.litigation) * (recent ? w.regulatorRuling.recentMultiplier : 1);
}

export function caseSignal(c: Case, party: string, now: Date): Signal {
  return {
    id: `litigation-sabin-${hash(c.url)}`,
    axis: "track",
    kind: "litigation.case",
    label: lw.caseFound(party, c.status, c.filed_year),
    weight_hint: caseWeightHint(c, now),
    source_url: c.url,
    fetched_at: c.fetchedAt,
    excerpt: lw.excerpt(c.title, firstChars(c.summary, RULING_EXCERPT_CHARS), c.status, c.last_event, c.url),
    entity_name: party,
    llm_used: false,
  };
}
