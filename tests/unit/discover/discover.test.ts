import { describe, expect, it } from "vitest";
import { discoverCandidates } from "@/lib/discover/discover";
import { fetchPages } from "@/lib/discover/fetch-pages";
import { isSustainabilityPath } from "@/lib/discover/heuristics";
import { guardedPageFetcher } from "@/lib/pipeline/run";
import { BRANDS, OfflineFetcher } from "../helpers/brands";

describe("discovery on the fixture brands (2.1)", () => {
  it.each(BRANDS)("$slug: ≥ 3 pages incl. a sustainability-type page, all from fixtures", async (brand) => {
    const fetcher = new OfflineFetcher();
    const { pageFetcher, robots } = guardedPageFetcher(fetcher);
    const { candidates, sitemap } = await discoverCandidates(brand.website, pageFetcher, robots);
    expect(sitemap.fetched.length).toBeGreaterThanOrEqual(1);
    const { pages } = await fetchPages(candidates, pageFetcher);

    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages.length).toBeLessThanOrEqual(12);
    expect(pages.some((p) => isSustainabilityPath(p.url))).toBe(true);
    expect(pages.map((p) => p.url)).toContain(brand.sustainabilityUrl);
    for (const p of pages) {
      expect(p.source).toBe("fixture");
      expect(p.wordCount).toBeGreaterThanOrEqual(50);
      expect(Number.isNaN(Date.parse(p.fetchedAt))).toBe(false);
    }
    // Every request went to the fixture fetcher (OfflineFetcher throws otherwise); robots.txt was read first.
    expect(fetcher.calls[0]).toBe(`${new URL(brand.website).origin}/robots.txt`);
  });

  it("serves the fixture capture date as fetched_at", async () => {
    const fetcher = new OfflineFetcher();
    const res = await fetcher.get("https://www.fairphone.com/impact-report");
    expect(res.status).toBe(200);
    expect(res.fetchedAt).toMatch(/^2026-10-20T/);
  });

  it("dedupes candidates and collapses translations (Northwind /fr/our-footprint/)", async () => {
    const fetcher = new OfflineFetcher();
    const { pageFetcher, robots } = guardedPageFetcher(fetcher);
    const { candidates } = await discoverCandidates("https://www.northwind-outdoor.example", pageFetcher, robots);
    const urls = candidates.map((c) => c.url);
    expect(urls[0]).toBe("https://www.northwind-outdoor.example");
    expect(urls).toContain("https://www.northwind-outdoor.example/our-footprint/");
    expect(urls).not.toContain("https://www.northwind-outdoor.example/fr/our-footprint/");
    expect(urls.some((u) => u.endsWith(".pdf"))).toBe(false);
    expect(new Set(urls).size).toBe(urls.length);
    // Heuristic paths come after sitemap matches.
    expect(candidates.findIndex((c) => c.via === "heuristic")).toBeGreaterThan(candidates.findIndex((c) => c.via === "sitemap"));
  });
});
