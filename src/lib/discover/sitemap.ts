import * as cheerio from "cheerio";
import type { Fetcher } from "../fetch/fetcher";

export interface ParsedSitemap {
  kind: "urlset" | "index" | "unknown";
  /** Page URLs (urlset) or child sitemap URLs (index), in document order. */
  locs: string[];
}

/** Parses a sitemap or sitemap index (sitemaps.org 0.9). Anything else ⇒ kind "unknown". */
export function parseSitemap(xml: string): ParsedSitemap {
  const $ = cheerio.load(xml, { xml: true });
  const locs = (sel: string) =>
    $(sel)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
  if ($("sitemapindex").length) return { kind: "index", locs: locs("sitemapindex > sitemap > loc") };
  if ($("urlset").length) return { kind: "urlset", locs: locs("urlset > url > loc") };
  return { kind: "unknown", locs: [] };
}

export interface SitemapCrawl {
  /** Accepted page URLs, at most `maxUrls`. */
  urls: string[];
  /** Sitemap URLs actually fetched and parsed. */
  fetched: string[];
  /** Sitemaps that could not be used, with the reason (missing, robots, not a sitemap…). */
  failed: { url: string; reason: string }[];
}

export interface SitemapOptions {
  maxSitemaps: number;
  maxUrls: number;
  /** Which page URLs to keep (e.g. same site + keyword match). */
  accept: (url: string) => boolean;
}

/** Child sitemaps that rarely hold editorial pages are visited last. */
const LOW_VALUE_CHILD = /product|image|video|media|recipe|blog|news|store|shop/i;

/**
 * Breadth-first walk over sitemaps and nested sitemap indexes, fetching at most
 * `maxSitemaps` documents and keeping at most `maxUrls` accepted page URLs.
 */
export async function crawlSitemaps(start: string[], fetcher: Fetcher, opts: SitemapOptions): Promise<SitemapCrawl> {
  const queue = [...new Set(start)];
  const seen = new Set(queue);
  const urls: string[] = [];
  const seenUrls = new Set<string>();
  const fetched: string[] = [];
  const failed: SitemapCrawl["failed"] = [];

  while (queue.length > 0 && fetched.length < opts.maxSitemaps && urls.length < opts.maxUrls) {
    const url = queue.shift()!;
    let body: string;
    try {
      const res = await fetcher.get(url);
      if (res.status < 200 || res.status >= 300) {
        failed.push({ url, reason: `HTTP ${res.status}` });
        continue;
      }
      body = res.body;
    } catch (err) {
      failed.push({ url, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const parsed = parseSitemap(body);
    if (parsed.kind === "unknown") {
      failed.push({ url, reason: "not a sitemap" });
      continue;
    }
    fetched.push(url);
    if (parsed.kind === "index") {
      const children = parsed.locs.filter((c) => !seen.has(c));
      const ordered = [...children.filter((c) => !LOW_VALUE_CHILD.test(c)), ...children.filter((c) => LOW_VALUE_CHILD.test(c))];
      for (const c of ordered) {
        seen.add(c);
        queue.push(c);
      }
      continue;
    }
    for (const loc of parsed.locs) {
      if (urls.length >= opts.maxUrls) break;
      if (seenUrls.has(loc) || !opts.accept(loc)) continue;
      seenUrls.add(loc);
      urls.push(loc);
    }
  }
  return { urls, fetched, failed };
}
