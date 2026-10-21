import { describe, expect, it } from "vitest";
import { discoverCandidates } from "@/lib/discover/discover";
import { fetchPages } from "@/lib/discover/fetch-pages";
import { DISCOVERY_CONFIG } from "@/lib/discover/heuristics";
import { crawlSitemaps, parseSitemap } from "@/lib/discover/sitemap";
import { guardedPageFetcher } from "@/lib/pipeline/run";
import { OfflineFetcher } from "../helpers/brands";
import { MapFetcher, htmlPage } from "../helpers/map-fetcher";

const SITE = "https://brand.example";
const urlset = (urls: string[]) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;
const index = (maps: string[]) =>
  `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${maps.map((u) => `<sitemap><loc>${u}</loc></sitemap>`).join("")}</sitemapindex>`;

describe("sitemap parsing", () => {
  it("parses a urlset and a sitemap index", () => {
    expect(parseSitemap(urlset([`${SITE}/a`, `${SITE}/b`]))).toEqual({ kind: "urlset", locs: [`${SITE}/a`, `${SITE}/b`] });
    expect(parseSitemap(index([`${SITE}/s1.xml`]))).toEqual({ kind: "index", locs: [`${SITE}/s1.xml`] });
    expect(parseSitemap("<html><body>not a sitemap</body></html>").kind).toBe("unknown");
  });

  it("decodes XML entities in <loc>", () => {
    expect(parseSitemap(urlset([`${SITE}/a?x=1&amp;y=2`])).locs).toEqual([`${SITE}/a?x=1&y=2`]);
  });
});

describe("nested sitemaps and caps (2.2)", () => {
  it("follows a sitemap index into nested indexes and urlsets", async () => {
    const fetcher = new MapFetcher({
      [`${SITE}/sitemap.xml`]: index([`${SITE}/sitemap-a.xml`, `${SITE}/nested-index.xml`]),
      [`${SITE}/nested-index.xml`]: index([`${SITE}/sitemap-b.xml`]),
      [`${SITE}/sitemap-a.xml`]: urlset([`${SITE}/sustainability`]),
      [`${SITE}/sitemap-b.xml`]: urlset([`${SITE}/our-impact`, `${SITE}/careers`]),
    });
    const crawl = await crawlSitemaps([`${SITE}/sitemap.xml`], fetcher, { maxSitemaps: 10, maxUrls: 200, accept: () => true });
    expect(crawl.fetched).toEqual([`${SITE}/sitemap.xml`, `${SITE}/sitemap-a.xml`, `${SITE}/nested-index.xml`, `${SITE}/sitemap-b.xml`]);
    expect(crawl.urls).toEqual([`${SITE}/sustainability`, `${SITE}/our-impact`, `${SITE}/careers`]);
  });

  it("follows the Northwind fixture's sitemap index (declared in robots.txt), page sitemaps before product sitemaps", async () => {
    const fetcher = new OfflineFetcher();
    const { pageFetcher, robots } = guardedPageFetcher(fetcher);
    const { sitemap } = await discoverCandidates("https://www.northwind-outdoor.example", pageFetcher, robots);
    expect(sitemap.fetched).toEqual([
      "https://www.northwind-outdoor.example/sitemap_index.xml",
      "https://www.northwind-outdoor.example/sitemap_pages.xml",
      "https://www.northwind-outdoor.example/sitemap_products.xml",
    ]);
  });

  it("stops after maxSitemaps documents and keeps at most maxUrls URLs", async () => {
    const files: Record<string, string> = { [`${SITE}/sitemap.xml`]: index(Array.from({ length: 20 }, (_, i) => `${SITE}/s${i}.xml`)) };
    for (let i = 0; i < 20; i++) files[`${SITE}/s${i}.xml`] = urlset(Array.from({ length: 50 }, (_, j) => `${SITE}/p${i}-${j}`));
    const fetcher = new MapFetcher(files);
    const few = await crawlSitemaps([`${SITE}/sitemap.xml`], fetcher, { maxSitemaps: 3, maxUrls: 1000, accept: () => true });
    expect(few.fetched).toHaveLength(3);
    const capped = await crawlSitemaps([`${SITE}/sitemap.xml`], fetcher, { maxSitemaps: 10, maxUrls: 200, accept: () => true });
    expect(capped.urls).toHaveLength(200);
  });

  it("enforces the cap of 12 pages per brand", async () => {
    const pages = Array.from({ length: 30 }, (_, i) => `${SITE}/sustainability/topic-${i}`);
    const files: Record<string, string> = {
      [`${SITE}/robots.txt`]: `User-agent: *\nDisallow:\nSitemap: ${SITE}/sitemap_index.xml\n`,
      [`${SITE}/sitemap_index.xml`]: index([`${SITE}/sitemap-1.xml`, `${SITE}/sitemap-2.xml`]),
      [`${SITE}/sitemap-1.xml`]: urlset(pages.slice(0, 15)),
      [`${SITE}/sitemap-2.xml`]: urlset(pages.slice(15)),
      [SITE]: htmlPage("Home"),
    };
    for (const p of pages) files[p] = htmlPage(p);
    const fetcher = new MapFetcher(files);
    const { pageFetcher, robots } = guardedPageFetcher(fetcher);
    const config = { ...DISCOVERY_CONFIG, ranking: { ...DISCOVERY_CONFIG.ranking, maxPerSection: 100 } };
    const { candidates } = await discoverCandidates(SITE, pageFetcher, robots, config);
    expect(candidates.length).toBeGreaterThan(12);
    const res = await fetchPages(candidates, pageFetcher, config);
    expect(res.pages).toHaveLength(12);
    expect(DISCOVERY_CONFIG.limits.maxPages).toBe(12);
    // Only robots.txt, 3 sitemaps and the 12 kept pages were requested.
    expect(fetcher.calls).toHaveLength(1 + 3 + 12);
  });
});
