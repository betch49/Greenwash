import { loadBrandFixtures } from "@/lib/fetch/brand-fixtures";
import type { FetchResult, Fetcher } from "@/lib/fetch/fetcher";
import { FixtureFetcher } from "@/lib/fetch/fixture-fetcher";

/** The three fixture brands (fixtures/brands/README.md) and what the tests expect of them. */
export const BRANDS = [
  {
    slug: "patagonia",
    website: "https://www.patagonia.com",
    sustainabilityPage: "pages/www-patagonia-com-our-footprint.html",
    sustainabilityUrl: "https://www.patagonia.com/our-footprint/",
    navSentinel: "NAV SENTINEL 7F3A",
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
