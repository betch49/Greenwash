import { readFileSync } from "node:fs";
import { join } from "node:path";
import { visibleText, type PageLink } from "@/lib/discover/visible-text";
import { loadBrandFixtures } from "@/lib/fetch/brand-fixtures";
import type { FetchResult, Fetcher } from "@/lib/fetch/fetcher";
import { FixtureFetcher } from "@/lib/fetch/fixture-fetcher";

/** The fictional, test-only fixture (ADR-011): hand-built edge cases on a reserved domain. */
export const NORTHWIND = {
  slug: "northwind",
  website: "https://www.northwind-outdoor.example",
  sustainabilityPage: "pages/www-northwind-outdoor-example-our-footprint.html",
  sustainabilityUrl: "https://www.northwind-outdoor.example/our-footprint/",
  navSentinel: "NAV SENTINEL 7F3A",
} as const;

/** The three real fixture brands (fixtures/brands/README.md) and what the tests expect of them. */
export const BRANDS = [
  {
    slug: "mammut",
    website: "https://www.mammut.com/us/en/",
    sustainabilityPage: "pages/www-mammut-com-us-en-responsibility.html",
    sustainabilityUrl: "https://www.mammut.com/us/en/responsibility",
    navSentinel: "Loyalty Program",
  },
  {
    slug: "fairphone",
    website: "https://www.fairphone.com/",
    sustainabilityPage: "pages/www-fairphone-com-impact-report.html",
    sustainabilityUrl: "https://www.fairphone.com/impact-report",
    navSentinel: "Shop smartphone accessories",
  },
  {
    slug: "oatly",
    website: "https://www.oatly.com/",
    sustainabilityPage: "pages/oatly-com-sustainability.html",
    sustainabilityUrl: "https://oatly.com/sustainability/",
    navSentinel: "For Investors",
  },
] as const;

/** Offline fetcher over fixtures/ that records every URL and fails the test on any non-fixture result. */
export class OfflineFetcher implements Fetcher {
  readonly calls: string[] = [];
  private readonly inner: FixtureFetcher;

  constructor(root = "fixtures") {
    const brands = loadBrandFixtures(root);
    this.inner = new FixtureFetcher(root, brands.map, (url) => brands.capturedAt(url) ?? "1970-01-01T00:00:00.000Z");
  }

  async get(url: string): Promise<FetchResult> {
    this.calls.push(url);
    const res = await this.inner.get(url);
    if (res.source !== "fixture") throw new Error(`non-fixture fetch: ${url}`);
    return res;
  }
}

/** Every HTML page of a brand fixture as the pipeline would hold it (visible text, links, capture date). */
export function loadBrandPages(slug: string, root = "fixtures"): { url: string; title: string; text: string; links: PageLink[]; fetchedAt: string; wordCount: number }[] {
  const dir = join(root, "brands", slug);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { capturedAt: string; files: Record<string, string> };
  return Object.entries(manifest.files)
    .filter(([, rel]) => rel.endsWith(".html"))
    .map(([url, rel]) => {
      const v = visibleText(readFileSync(join(dir, rel), "utf8"), url);
      return { url, title: v.title, text: v.text, links: v.links, fetchedAt: manifest.capturedAt, wordCount: v.wordCount };
    });
}

/** One fixture page by its file, with the brand's capture date. */
export function loadBrandPage(slug: string, file: string, url: string, root = "fixtures") {
  const dir = join(root, "brands", slug);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { capturedAt: string };
  const v = visibleText(readFileSync(join(dir, file), "utf8"), url);
  return { url, title: v.title, text: v.text, links: v.links, fetchedAt: manifest.capturedAt, wordCount: v.wordCount };
}
