import { createHash } from "node:crypto";
import { reasons } from "../copy/wording";
import { FetchError, type FetchSource, type Fetcher } from "../fetch/fetcher";
import { RobotsDisallowedError } from "../fetch/robots";
import { DISCOVERY_CONFIG, type Candidate, type CandidateVia, type DiscoveryConfig } from "./heuristics";
import { visibleText, type PageLink } from "./visible-text";

/** A fetched brand page: the receipt source for every claim signal found on it. */
export interface FetchedPage {
  url: string;
  via: CandidateVia;
  title: string;
  text: string;
  wordCount: number;
  links: PageLink[];
  fetchedAt: string;
  source: FetchSource;
  /** SHA-1 of the visible text; identical pages (redirects, bot walls) are kept once. */
  contentHash: string;
}

export interface PageSkip {
  url: string;
  reason: string;
  robots: boolean;
}

export interface FetchPagesResult {
  pages: FetchedPage[];
  /** Pages we tried and could not use, shown as "skipped: <reason>". */
  skipped: PageSkip[];
  /** Candidates that do not exist (404/410): expected for heuristic paths, not an error. */
  notFound: string[];
  /** Candidates whose visible text duplicates an earlier page. */
  duplicates: string[];
}

/**
 * Fetches candidates in order until `maxPages` usable HTML pages are collected.
 * `fetcher` must be the robots-guarded page fetcher (ADR-010): a disallowed URL
 * is never requested and is recorded as skipped with the robots.txt reason.
 */
export async function fetchPages(
  candidates: Candidate[],
  fetcher: Fetcher,
  config: DiscoveryConfig = DISCOVERY_CONFIG,
): Promise<FetchPagesResult> {
  const out: FetchPagesResult = { pages: [], skipped: [], notFound: [], duplicates: [] };
  const hashes = new Set<string>();
  let attempts = 0;
  for (const c of candidates) {
    if (out.pages.length >= config.limits.maxPages || attempts >= config.limits.maxFetchAttempts) break;
    let res;
    try {
      res = await fetcher.get(c.url);
    } catch (err) {
      if (err instanceof RobotsDisallowedError) {
        out.skipped.push({ url: c.url, reason: err.message, robots: true });
        continue;
      }
      attempts++;
      const message = err instanceof FetchError && err.status ? `HTTP ${err.status}` : err instanceof Error ? err.message : String(err);
      out.skipped.push({ url: c.url, reason: reasons.fetchFailed(c.url, message), robots: false });
      continue;
    }
    attempts++;
    if (res.status === 404 || res.status === 410) {
      out.notFound.push(c.url);
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      out.skipped.push({ url: c.url, reason: reasons.httpStatus(res.status, c.url), robots: false });
      continue;
    }
    const type = res.contentType.toLowerCase();
    if (type && !type.includes("html")) {
      out.skipped.push({ url: c.url, reason: reasons.notHtml(c.url, type.split(";")[0]), robots: false });
      continue;
    }
    const vt = visibleText(res.body, c.url);
    if (vt.wordCount < config.limits.minWords) {
      out.skipped.push({ url: c.url, reason: reasons.tooLittleText(c.url, vt.wordCount), robots: false });
      continue;
    }
    const contentHash = createHash("sha1").update(vt.text).digest("hex");
    if (hashes.has(contentHash)) {
      out.duplicates.push(c.url);
      continue;
    }
    hashes.add(contentHash);
    out.pages.push({
      url: c.url,
      via: c.via,
      title: vt.title,
      text: vt.text,
      wordCount: vt.wordCount,
      links: vt.links,
      fetchedAt: res.fetchedAt,
      source: res.source,
      contentHash,
    });
  }
  return out;
}
