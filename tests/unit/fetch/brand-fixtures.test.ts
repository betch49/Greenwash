import { describe, expect, it } from "vitest";
import { fixtureKey, loadBrandFixtures } from "@/lib/fetch/brand-fixtures";
import { parseRobots } from "@/lib/fetch/robots";

describe("brand fixtures", () => {
  it("normalises manifest keys", () => {
    expect(fixtureKey("https://WWW.Patagonia.com/our-footprint/#x")).toBe("https://www.patagonia.com/our-footprint");
    expect(fixtureKey("https://www.patagonia.com")).toBe("https://www.patagonia.com/");
    expect(fixtureKey("not a url")).toBeNull();
  });

  it("maps every manifest URL to an existing brand file and reports its capture date", () => {
    const b = loadBrandFixtures("fixtures");
    expect(b.map("https://www.patagonia.com/our-footprint")).toBe("brands/patagonia/pages/www-patagonia-com-our-footprint.html");
    expect(b.map("https://www.fairphone.com/robots.txt")).toBe("brands/fairphone/robots/www-fairphone-com.txt");
    expect(b.map("https://www.patagonia.com/not-recorded")).toBeNull();
    expect(b.capturedAt("https://www.patagonia.com/")).toBe("2026-10-20T22:45:00.000Z");
  });

  it("reads Sitemap lines from robots.txt", () => {
    const r = parseRobots("User-agent: *\nDisallow: /x\nSitemap: https://a.example/s.xml\nsitemap: https://a.example/t.xml\nSitemap: /relative.xml\n");
    expect(r.sitemaps).toEqual(["https://a.example/s.xml", "https://a.example/t.xml"]);
  });
});
