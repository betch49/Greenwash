import { describe, expect, it } from "vitest";
import type { WikidataEntity } from "@/lib/wikidata/entities";
import { isCompanyLike, normaliseName, rankCandidates, websiteHost } from "@/lib/wikidata/rank";
import { wikidataFixturePath } from "@/lib/wikidata/fixtures";
import { entitiesUrl, searchUrl } from "@/lib/wikidata/api";

const entity = (over: Partial<WikidataEntity>): WikidataEntity => ({
  id: "Q1",
  label: "Example",
  aliases: [],
  industries: [],
  countries: [],
  instanceOf: [{ id: "Q783794", label: "company" }],
  classParents: {},
  ...over,
});

describe("name normalisation", () => {
  it("strips case, diacritics, punctuation and legal suffixes", () => {
    expect(normaliseName("Patagonia, Inc.")).toBe("patagonia");
    expect(normaliseName("Oatly AB")).toBe("oatly");
    expect(normaliseName("Nestlé S.A.")).toBe("nestle");
    expect(normaliseName("Marks & Spencer Group plc")).toBe("marks and spencer");
    expect(normaliseName("Inc")).toBe("inc"); // never strips to empty
  });

  it("extracts the website host without www", () => {
    expect(websiteHost("https://www.patagonia.com")).toBe("patagonia.com");
    expect(websiteHost("not a url")).toBeUndefined();
  });
});

describe("company-like classes", () => {
  it("accepts direct company classes and direct subclasses of them", () => {
    expect(isCompanyLike(entity({}))).toBe(true);
    expect(
      isCompanyLike(entity({ instanceOf: [{ id: "Q999", label: "outdoor retailer" }], classParents: { Q999: ["Q4830453"] } })),
    ).toBe(true);
  });

  it("rejects non-company and fictional items", () => {
    expect(isCompanyLike(entity({ instanceOf: [{ id: "Q5", label: "human" }] }))).toBe(false);
    expect(
      isCompanyLike(
        entity({
          instanceOf: [
            { id: "Q783794", label: "company" },
            { id: "Q1", label: "fictional company" },
          ],
        }),
      ),
    ).toBe(false);
  });
});

describe("rankCandidates rule", () => {
  it("is confident only for a single exact-name company with a website", () => {
    const r = rankCandidates("Example", [
      entity({ id: "Q1", label: "Example Inc.", website: "https://example.com" }),
      entity({ id: "Q2", label: "Example Holdings", website: "https://exh.example" }),
    ]);
    expect(r.confident?.id).toBe("Q1");
  });

  it("is not confident when two exact-name companies have websites", () => {
    const r = rankCandidates("Example", [
      entity({ id: "Q1", label: "Example Inc.", website: "https://example.com" }),
      entity({ id: "Q2", label: "Example", website: "https://example.org" }),
    ]);
    expect(r.confident).toBeNull();
    expect(r.candidates.map((c) => c.id)).toEqual(["Q1", "Q2"]);
  });

  it("is not confident without a website, and caps candidates at 3", () => {
    const many = [1, 2, 3, 4, 5].map((i) => entity({ id: `Q${i}`, label: i === 1 ? "Example" : `Example ${i}` }));
    const r = rankCandidates("Example", many);
    expect(r.confident).toBeNull();
    expect(r.candidates).toHaveLength(3);
    expect(r.candidates[0].id).toBe("Q1"); // exact name ranks first
  });

  it("matches on aliases", () => {
    const r = rankCandidates("Patagonia", [
      entity({ label: "Lost Arrow Corporation", aliases: ["Patagonia"], website: "https://patagonia.com" }),
    ]);
    expect(r.confident?.name).toBe("Lost Arrow Corporation");
  });
});

describe("fixture paths", () => {
  it("maps search and entity URLs to stable fixture files", () => {
    expect(wikidataFixturePath(searchUrl("Patagonia", 7))).toBe("wikidata/search-patagonia.json");
    expect(wikidataFixturePath(entitiesUrl(["Q2", "Q1"], "labels"))).toBe("wikidata/labels-Q1_Q2.json");
    expect(wikidataFixturePath(entitiesUrl(["Q1"], "full"))).toBe("wikidata/entities-Q1.json");
    expect(wikidataFixturePath("https://example.com/")).toBeNull();
  });
});
