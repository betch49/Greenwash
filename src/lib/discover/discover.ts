import type { Fetcher } from "../fetch/fetcher";
import type { RobotsChecker } from "../fetch/robots";
import {
  DISCOVERY_CONFIG,
  heuristicCandidates,
  keywordScore,
  rankSitemapUrls,
  sameSite,
  stripLocale,
  urlKey,
  type Candidate,
  type DiscoveryConfig,
} from "./heuristics";
import { crawlSitemaps, type SitemapCrawl } from "./sitemap";

export interface DiscoveryResult {
  /** Pages to try, in order: home page, ranked sitemap matches, then heuristic paths. */
  candidates: Candidate[];
  sitemap: SitemapCrawl;
}

/**
 * Finds candidate pages for a brand website: sitemaps declared in robots.txt
 * (or /sitemap.xml), filtered by keywords, plus the configured heuristic paths.
 * `fetcher` must be the robots-guarded page fetcher (ADR-010); `robots` is the
 * checker it uses, read here only for its Sitemap lines.
 */
export async function discoverCandidates(
  website: string,
  fetcher: Fetcher,
  robots: RobotsChecker,
  config: DiscoveryConfig = DISCOVERY_CONFIG,
): Promise<DiscoveryResult> {
  const origin = new URL(website).origin;
  const declared = (await robots.sitemaps(origin)).filter((s) => sameSite(s, website));
  const start = declared.length > 0 ? declared : [`${origin}/sitemap.xml`];
  const sitemap = await crawlSitemaps(start, fetcher, {
    maxSitemaps: config.limits.maxSitemaps,
    maxUrls: config.limits.maxSitemapUrls,
    accept: (u) => {
      try {
        return sameSite(u, website) && keywordScore(stripLocale(new URL(u).pathname).rest, config.sitemapKeywords) > 0;
      } catch {
        return false;
      }
    },
  });

  const ordered: Candidate[] = [
    { url: website, via: "home", score: 0 },
    ...rankSitemapUrls(sitemap.urls, website, config),
    ...heuristicCandidates(website, config),
  ];
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const c of ordered) {
    const key = urlKey(c.url);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(c);
    if (candidates.length >= config.limits.maxFetchAttempts) break;
  }
  return { candidates, sitemap };
}
