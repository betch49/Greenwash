import discovery from "../../../config/discovery.json";

export interface DiscoveryConfig {
  heuristicPaths: string[];
  sitemapKeywords: Record<string, number>;
  sustainabilityKeywords: string[];
  ranking: { depthPenalty: number; maxPerSection: number };
  limits: {
    maxPages: number;
    maxFetchAttempts: number;
    maxSitemapUrls: number;
    maxSitemaps: number;
    minWords: number;
  };
  /** Wikidata P452 industry labels (lowercase) for which the repair axis is not applicable (Phase 5). */
  nonDurableIndustries?: string[];
}

export const DISCOVERY_CONFIG: DiscoveryConfig = discovery;

export type CandidateVia = "home" | "sitemap" | "heuristic";

export interface Candidate {
  url: string;
  via: CandidateVia;
  /** Keyword weight that selected it (0 for the home page). */
  score: number;
}

/** A first path segment that looks like a locale: "fr", "en-gb", "de_DE". */
const LOCALE_SEGMENT = /^[a-z]{2}([-_][a-z]{2,3})?$/i;
const NON_HTML = /\.(pdf|jpe?g|png|gif|webp|svg|xml|gz|zip|json|txt|csv|mp4|mp3|docx?|xlsx?)$/i;

export const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** Same site = same host once a leading "www." is ignored (oatly.com ≡ www.oatly.com). */
export function sameSite(a: string, b: string): boolean {
  try {
    return bareHost(new URL(a).host) === bareHost(new URL(b).host);
  } catch {
    return false;
  }
}

/**
 * Splits a leading locale off a path: "/da-dk/sustainability" ⇒ { locale: "da-dk", rest: "/sustainability" };
 * a country/language pair of two-letter segments counts as one locale: "/us/en/responsibility" ⇒ "us/en".
 */
export function stripLocale(pathname: string): { locale: string | null; rest: string } {
  const pair = /^\/([a-z]{2})\/([a-z]{2})(\/.*)?$/i.exec(pathname);
  if (pair) return { locale: `${pair[1]}/${pair[2]}`.toLowerCase(), rest: pair[3] || "/" };
  const m = /^\/([^/]+)(\/.*)?$/.exec(pathname);
  if (m && LOCALE_SEGMENT.test(m[1])) return { locale: m[1].toLowerCase(), rest: m[2] || "/" };
  return { locale: null, rest: pathname || "/" };
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p) || "/";

/** Dedupe key: bare host + path without trailing slash + query; no fragment. */
export function urlKey(url: string): string {
  const u = new URL(url);
  return `${bareHost(u.host)}${trimSlash(u.pathname).toLowerCase()}${u.search}`;
}

/** Highest weight among the keywords contained in the (locale-stripped, lowercased) path; 0 if none. */
export function keywordScore(path: string, keywords: Record<string, number>): number {
  const p = path.toLowerCase();
  let best = 0;
  for (const [kw, weight] of Object.entries(keywords)) if (p.includes(kw) && weight > best) best = weight;
  return best;
}

/** Locale preference among translations of one page: the website's own locale, no locale, English, then the rest. */
function localeRank(locale: string | null, siteLocale: string | null): number {
  if (siteLocale && locale === siteLocale) return -1;
  if (!locale) return 0;
  const lang = locale.includes("/") ? locale.split("/")[1] : locale;
  return lang === "en" || lang.startsWith("en-") || lang.startsWith("en_") ? 1 : 2;
}

const depth = (path: string) => path.split("/").filter(Boolean).length;

/**
 * Keeps same-site HTML-looking sitemap URLs whose path matches a keyword, collapses
 * translations of the same page to one URL, ranks them by keyword weight minus a
 * depth penalty (then shallower, shorter, alphabetical: deterministic), and keeps
 * at most `maxPerSection` deep URLs under one first path segment.
 */
export function rankSitemapUrls(urls: string[], website: string, config: DiscoveryConfig = DISCOVERY_CONFIG): Candidate[] {
  const best = new Map<string, { url: string; score: number; rank: number; locale: number; depth: number; section: string }>();
  const siteLocale = stripLocale(new URL(website).pathname).locale;
  for (const raw of urls) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !sameSite(raw, website)) continue;
    if (NON_HTML.test(u.pathname)) continue;
    const { locale, rest } = stripLocale(u.pathname);
    const score = keywordScore(rest, config.sitemapKeywords);
    if (score === 0) continue;
    u.hash = "";
    const key = `${trimSlash(rest).toLowerCase()}${u.search}`;
    const d = depth(rest);
    const entry = {
      url: u.toString(),
      score,
      rank: score - config.ranking.depthPenalty * Math.max(0, d - 1),
      locale: localeRank(locale, siteLocale),
      depth: d,
      section: d > 1 ? rest.split("/").filter(Boolean)[0].toLowerCase() : "",
    };
    const prev = best.get(key);
    if (!prev || entry.locale < prev.locale) best.set(key, entry);
  }
  const sorted = [...best.values()].sort(
    (a, b) =>
      b.rank - a.rank ||
      a.depth - b.depth ||
      a.locale - b.locale ||
      a.url.length - b.url.length ||
      (a.url < b.url ? -1 : a.url > b.url ? 1 : 0),
  );
  const perSection = new Map<string, number>();
  const out: Candidate[] = [];
  for (const e of sorted) {
    if (e.section) {
      const n = perSection.get(e.section) ?? 0;
      if (n >= config.ranking.maxPerSection) continue;
      perSection.set(e.section, n + 1);
    }
    out.push({ url: e.url, via: "sitemap", score: e.score });
  }
  return out;
}

/** The configured heuristic paths on the website's origin. */
export function heuristicCandidates(website: string, config: DiscoveryConfig = DISCOVERY_CONFIG): Candidate[] {
  const origin = new URL(website).origin;
  return config.heuristicPaths.map((p) => ({
    url: origin + p,
    via: "heuristic" as const,
    score: keywordScore(p, config.sitemapKeywords),
  }));
}

/** True when the URL's path matches the sustainability-type heuristics (not repair/warranty/support/about). */
export function isSustainabilityPath(url: string, config: DiscoveryConfig = DISCOVERY_CONFIG): boolean {
  const rest = stripLocale(new URL(url).pathname).rest.toLowerCase();
  return config.sustainabilityKeywords.some((kw) => rest.includes(kw));
}
