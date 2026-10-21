import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixtureKey, loadBrandFixtures, type BrandManifest } from "@/lib/fetch/brand-fixtures";
import { parseRobots } from "@/lib/fetch/robots";

const ROOT = join("fixtures", "brands");
const slugs = readdirSync(ROOT).filter((s) => existsSync(join(ROOT, s, "meta.json")));

interface Meta {
  slug: string;
  website: string;
  capture: "real" | "synthetic";
  entity: { id: string | null; website?: string };
}
const meta = (slug: string) => JSON.parse(readFileSync(join(ROOT, slug, "meta.json"), "utf8")) as Meta;
const manifest = (slug: string) => JSON.parse(readFileSync(join(ROOT, slug, "manifest.json"), "utf8")) as BrandManifest;

/** RFC 2606 / RFC 6761 reserved top-level domains: never a real brand's site. */
const RESERVED_TLD = /\.(example|test|invalid)$/i;

describe("brand fixtures", () => {
  it("normalises manifest keys", () => {
    expect(fixtureKey("https://WWW.Brand.example/our-footprint/#x")).toBe("https://www.brand.example/our-footprint");
    expect(fixtureKey("https://www.brand.example")).toBe("https://www.brand.example/");
    expect(fixtureKey("not a url")).toBeNull();
  });

  it("maps every manifest URL to an existing brand file and reports its capture date", () => {
    const b = loadBrandFixtures("fixtures");
    expect(b.map("https://www.northwind-outdoor.example/our-footprint")).toBe(
      "brands/northwind/pages/www-northwind-outdoor-example-our-footprint.html",
    );
    expect(b.map("https://www.fairphone.com/robots.txt")).toBe("brands/fairphone/robots/www-fairphone-com.txt");
    expect(b.map("https://www.northwind-outdoor.example/not-recorded")).toBeNull();
    expect(b.capturedAt("https://www.northwind-outdoor.example/")).toBe("2026-10-20T22:45:00.000Z");
    for (const slug of slugs) {
      for (const rel of Object.values(manifest(slug).files)) expect(existsSync(join(ROOT, slug, rel)), `${slug}/${rel}`).toBe(true);
    }
  });

  it("reads Sitemap lines from robots.txt", () => {
    const r = parseRobots("User-agent: *\nDisallow: /x\nSitemap: https://a.example/s.xml\nsitemap: https://a.example/t.xml\nSitemap: /relative.xml\n");
    expect(r.sitemaps).toEqual(["https://a.example/s.xml", "https://a.example/t.xml"]);
  });
});

describe("ADR-011: synthetic fixtures never impersonate a real brand", () => {
  it("the real brands are the three v1 brands plus the Phase 10 validation captures, plus test-only synthetic ones", () => {
    // v1 fixture brands (PLAN conventions) + the ground-truth offline subset (PLAN Phase 10 deliverable 4).
    expect(slugs.filter((s) => meta(s).capture === "real").sort()).toEqual(["essity", "fairphone", "innocent", "mammut", "oatly", "signify", "totalenergies"]);
    for (const s of slugs) expect(["real", "synthetic"]).toContain(meta(s).capture);
  });

  it.each(slugs)("%s: a synthetic fixture lives on a reserved TLD and has no Wikidata id", (slug) => {
    const m = meta(slug);
    if (m.capture !== "synthetic") return;
    expect(new URL(m.website).hostname).toMatch(RESERVED_TLD);
    if (m.entity.website) expect(new URL(m.entity.website).hostname).toMatch(RESERVED_TLD);
    expect(m.entity.id ?? null).toBeNull();
    for (const url of Object.keys(manifest(slug).files)) expect(new URL(url).hostname, url).toMatch(RESERVED_TLD);
  });

  it.each(slugs)("%s: Wayback histories (Phase 4): hand-built only for a fictional brand; every CDX row has its snapshot file", (slug) => {
    const m = meta(slug);
    const history = manifest(slug).wayback ?? {};
    for (const [pageUrl, pageSlug] of Object.entries(history)) {
      if (m.capture === "synthetic") expect(new URL(pageUrl).hostname, pageUrl).toMatch(RESERVED_TLD);
      const cdxFile = join(ROOT, slug, "cdx", `${pageSlug}.json`);
      expect(existsSync(cdxFile), cdxFile).toBe(true);
      const rows = JSON.parse(readFileSync(cdxFile, "utf8")) as string[][];
      for (const row of rows.slice(1)) {
        const [ts, original] = [row[rows[0].indexOf("timestamp")], row[rows[0].indexOf("original")]];
        if (m.capture === "synthetic") expect(new URL(original).hostname, original).toMatch(RESERVED_TLD);
        const file = join(ROOT, slug, "snapshots", pageSlug, `${ts.slice(0, 8)}.html`);
        expect(existsSync(file), file).toBe(true);
        const head = readFileSync(file, "utf8");
        // A real brand's timeline may only come from recorded id_ responses, never from hand-built pages (ADR-011).
        if (m.capture === "real") expect(head.startsWith("<!-- real capture: "), file).toBe(true);
        else expect(head.startsWith("<!-- synthetic fixture"), file).toBe(true);
      }
    }
    // No stray snapshot directories outside the manifest.
    const snapDir = join(ROOT, slug, "snapshots");
    if (existsSync(snapDir)) for (const d of readdirSync(snapDir)) expect(Object.values(history), `${slug}/snapshots/${d}`).toContain(d);
  });

  it.each(slugs)("%s: every HTML file of a real fixture starts with the 'real capture:' comment", (slug) => {
    const m = meta(slug);
    if (m.capture !== "real") return;
    expect(m.entity.id).toMatch(/^Q\d+$/);
    expect(new URL(m.website).hostname).not.toMatch(RESERVED_TLD);
    const html = Object.values(manifest(slug).files).filter((rel) => rel.endsWith(".html"));
    expect(html.length).toBeGreaterThan(0);
    for (const rel of html) {
      expect(readFileSync(join(ROOT, slug, rel), "utf8").startsWith("<!-- real capture: "), rel).toBe(true);
    }
  });
});
