import { describe, expect, it } from "vitest";
import {
  DISCOVERY_CONFIG,
  heuristicCandidates,
  isSustainabilityPath,
  keywordScore,
  rankSitemapUrls,
  sameSite,
  stripLocale,
  urlKey,
} from "@/lib/discover/heuristics";

describe("discovery heuristics", () => {
  it("probes the configured heuristic paths on the origin", () => {
    const urls = heuristicCandidates("https://brand.example/en/home").map((c) => c.url);
    expect(urls).toHaveLength(DISCOVERY_CONFIG.heuristicPaths.length);
    for (const p of ["/sustainability", "/impact", "/responsibility", "/our-footprint", "/about", "/environment", "/planet", "/repair", "/warranty", "/support"]) {
      expect(urls).toContain(`https://brand.example${p}`);
    }
  });

  it("treats www and bare host as the same site", () => {
    expect(sameSite("https://oatly.com/x", "https://www.oatly.com/")).toBe(true);
    expect(sameSite("https://shop.oatly.com/x", "https://www.oatly.com/")).toBe(false);
  });

  it("splits locale prefixes", () => {
    expect(stripLocale("/da-dk/sustainability")).toEqual({ locale: "da-dk", rest: "/sustainability" });
    expect(stripLocale("/fr")).toEqual({ locale: "fr", rest: "/" });
    expect(stripLocale("/sustainability")).toEqual({ locale: null, rest: "/sustainability" });
    // Country/language pairs (Mammut: /us/en/, /de/de/) are one locale, so translations collapse.
    expect(stripLocale("/us/en/responsibility")).toEqual({ locale: "us/en", rest: "/responsibility" });
    expect(stripLocale("/de/de/")).toEqual({ locale: "de/de", rest: "/" });
  });

  it("prefers the website's own locale among translations of one page", () => {
    const urls = ["https://www.brand.example/de/de/responsibility", "https://www.brand.example/us/en/responsibility", "https://www.brand.example/fr/fr/responsibility"];
    expect(rankSitemapUrls(urls, "https://www.brand.example/us/en/").map((c) => c.url)).toEqual(["https://www.brand.example/us/en/responsibility"]);
    expect(rankSitemapUrls(urls, "https://www.brand.example/fr/fr/").map((c) => c.url)).toEqual(["https://www.brand.example/fr/fr/responsibility"]);
  });

  it("builds a dedupe key that ignores www, trailing slash and fragments", () => {
    expect(urlKey("https://www.x.com/A/#f")).toBe(urlKey("https://x.com/a"));
  });

  it("scores paths by the strongest keyword", () => {
    expect(keywordScore("/our-sustainability-impact", DISCOVERY_CONFIG.sitemapKeywords)).toBe(10);
    expect(keywordScore("/careers", DISCOVERY_CONFIG.sitemapKeywords)).toBe(0);
  });

  it("ranks sitemap URLs deterministically, collapses translations and caps deep sections", () => {
    const site = "https://www.brand.example/";
    const ranked = rankSitemapUrls(
      [
        "https://brand.example/de-de/sustainability",
        "https://brand.example/en-gb/sustainability",
        "https://brand.example/sustainability",
        "https://brand.example/careers",
        "https://brand.example/blog/a-sustainable-story",
        "https://brand.example/blog/another-sustainable-story",
        "https://brand.example/blog/third-sustainability-story",
        "https://brand.example/blog/fourth-sustainability-story",
        "https://brand.example/repair",
        "https://other.example/sustainability",
        "https://brand.example/impact-report.pdf",
      ],
      site,
    ).map((c) => c.url);
    expect(ranked[0]).toBe("https://brand.example/sustainability");
    expect(ranked[1]).toBe("https://brand.example/repair");
    expect(ranked.filter((u) => u.includes("/blog/"))).toHaveLength(DISCOVERY_CONFIG.ranking.maxPerSection);
    expect(ranked).not.toContain("https://brand.example/careers");
    expect(ranked).not.toContain("https://other.example/sustainability");
    expect(ranked).not.toContain("https://brand.example/impact-report.pdf");
    expect(ranked.filter((u) => u.endsWith("/sustainability"))).toHaveLength(1);
  });

  it("prefers the English translation when no unprefixed page exists", () => {
    const ranked = rankSitemapUrls(["https://brand.example/de-de/impact", "https://brand.example/en-us/impact"], "https://brand.example");
    expect(ranked.map((c) => c.url)).toEqual(["https://brand.example/en-us/impact"]);
  });

  it("recognises sustainability-type paths", () => {
    expect(isSustainabilityPath("https://x.com/fr/our-footprint/")).toBe(true);
    expect(isSustainabilityPath("https://x.com/impact-report")).toBe(true);
    expect(isSustainabilityPath("https://x.com/warranty")).toBe(false);
  });
});
