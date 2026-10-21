// Criterion 10.1: the recorded ground truth parses and follows the SOURCES.md rules.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GroundTruthSchema, groundTruthProblems, loadGroundTruth, ofGroup, parseGroundTruth, positiveMarkers, UNVERIFIABLE_SOURCES } from "@/lib/validation/ground-truth";

const raw = JSON.parse(readFileSync(join("fixtures", "validation", "ground-truth.json"), "utf8"));

describe("fixtures/validation/ground-truth.json (10.1)", () => {
  const gt = loadGroundTruth();

  it("is evaluation-only and parses", () => {
    expect(gt.label_use).toBe("evaluation_only");
    expect(gt.version).toBe(1);
  });

  it("has at least 15 flagged and 15 well-rated entries", () => {
    expect(ofGroup(gt, "flagged").length).toBeGreaterThanOrEqual(15);
    expect(ofGroup(gt, "well_rated").length).toBeGreaterThanOrEqual(15);
  });

  it("every entry has a citation with an http url, an ISO date and a non-empty why", () => {
    for (const e of gt.entries) {
      expect(e.citations.length, e.slug).toBeGreaterThanOrEqual(1);
      for (const c of e.citations) {
        expect(c.url, e.slug).toMatch(/^https?:\/\//);
        expect(c.date, e.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(c.date)), e.slug).toBe(false);
        expect(c.why.trim().length, e.slug).toBeGreaterThan(0);
      }
    }
  });

  it("no slug twice, no fictional .example brand", () => {
    const slugs = gt.entries.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const e of gt.entries) expect(new URL(e.website).hostname.endsWith(".example"), e.slug).toBe(false);
    expect(slugs).not.toContain("northwind");
    expect(slugs).not.toContain("quillmoor");
  });

  it("verified_from_container is false only on newclimate or bcorp citations", () => {
    for (const e of gt.entries) for (const c of e.citations) if (!c.verified_from_container) expect(UNVERIFIABLE_SOURCES, `${e.slug} ${c.url}`).toContain(c.source);
  });

  it("every verified citation and every check has its recorded copy on disk", () => {
    for (const e of gt.entries) {
      for (const c of [...e.citations, ...e.checks]) {
        if ("verified_from_container" in c && !c.verified_from_container) continue;
        expect(c.file, `${e.slug} ${c.url}`).toBeTruthy();
        expect(existsSync(join("fixtures", "validation", c.file!)), `${e.slug} ${c.file}`).toBe(true);
      }
    }
  });

  it("groups follow the rules: flagged has a flag, well-rated has none plus two markers and clean checks, contested has both", () => {
    expect(groundTruthProblems(gt)).toEqual([]);
    for (const e of ofGroup(gt, "well_rated")) {
      expect(positiveMarkers(e), e.slug).toBeGreaterThanOrEqual(2);
      expect(e.checks.map((c) => c.source).sort(), e.slug).toEqual(["asa", "changing_markets", "jdp"]);
    }
    for (const e of ofGroup(gt, "flagged")) expect(e.citations.some((c) => c.role === "flag"), e.slug).toBe(true);
  });

  it("entries that name an offline fixture point at a real brand fixture", () => {
    for (const e of gt.entries.filter((x) => x.fixture)) {
      const meta = JSON.parse(readFileSync(join("fixtures", "brands", e.fixture!, "meta.json"), "utf8")) as { capture: string };
      expect(meta.capture, e.slug).toBe("real");
    }
  });
});

describe("the ground-truth rules reject bad files", () => {
  const entry = (over: Record<string, unknown>) => ({
    slug: "acme",
    name: "Acme",
    website: "https://www.acme.com/",
    group: "flagged",
    citations: [{ source: "changing_markets", role: "flag", url: "https://greenwash.com/brands/acme", date: "2026-10-21", why: "listed", verified_from_container: true, file: "citations/acme-1.html" }],
    ...over,
  });
  const doc = (entries: unknown[], extra: Record<string, unknown> = {}) => ({ version: 1, label_use: "evaluation_only", entries, ...extra });

  it("rejects a label_use other than evaluation_only", () => {
    expect(() => parseGroundTruth(doc([entry({})], { label_use: "scoring" }))).toThrow();
  });
  it("rejects a duplicate slug, a .example brand, an unverified ASA citation", () => {
    expect(() => parseGroundTruth(doc([entry({}), entry({})]))).toThrow(/twice/);
    expect(() => parseGroundTruth(doc([entry({ website: "https://www.northwind-outdoor.example" })]))).toThrow(/fictional/);
    expect(() =>
      parseGroundTruth(doc([entry({ citations: [{ source: "asa", role: "flag", url: "https://www.asa.org.uk/x", date: "2026-10-21", why: "w", verified_from_container: false }] })])),
    ).toThrow(/newclimate or bcorp/);
  });
  it("accepts an unverified NewClimate citation, rejects a missing why or a non-ISO date", () => {
    expect(() =>
      parseGroundTruth(doc([entry({ citations: [{ source: "newclimate", role: "flag", url: "https://newclimate.org/x", date: "2025-06-01", why: "low integrity", verified_from_container: false }] })])),
    ).not.toThrow();
    expect(GroundTruthSchema.safeParse(doc([entry({ citations: [{ source: "asa", role: "flag", url: "https://a.b/", date: "2026-10-21", why: " ", verified_from_container: true }] })])).success).toBe(false);
    expect(GroundTruthSchema.safeParse(doc([entry({ citations: [{ source: "asa", role: "flag", url: "https://a.b/", date: "21/10/2026", why: "w", verified_from_container: true }] })])).success).toBe(false);
  });
  it("rejects well-rated with one marker, and flagged with two markers (that is contested)", () => {
    const pos = (source: string) => ({ source, role: "positive", url: `https://${source}.org/x`, date: "2026-10-21", why: "w", verified_from_container: true });
    expect(() => parseGroundTruth(doc([entry({ group: "well_rated", citations: [pos("sbti")] })]))).toThrow(/two positive markers/);
    expect(() => parseGroundTruth(doc([entry({ group: "well_rated", citations: [pos("sbti"), pos("sbti")] })]))).toThrow(/two positive markers/);
    const flagged = entry({});
    expect(() => parseGroundTruth(doc([{ ...flagged, citations: [...flagged.citations, pos("sbti"), pos("netzerotracker")] }]))).toThrow(/contested/);
  });
  it("the committed file is the one the loader reads", () => {
    expect(parseGroundTruth(raw).entries.length).toBe(loadGroundTruth().entries.length);
  });
});
