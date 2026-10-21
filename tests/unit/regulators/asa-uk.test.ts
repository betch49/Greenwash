import { describe, expect, it } from "vitest";
import { asaOutcome, asaUk, parseAsaRuling, parseAsaSearch } from "@/lib/regulators/asa-uk";
import { RegulatorParseError } from "@/lib/regulators/adapter";
import { source } from "../helpers/sources";

const OATLY_SEARCH = "https://www.asa.org.uk/search.html?q=Oatly";
const OATLY_RULING = "https://www.asa.org.uk/rulings/oatly-uk-ltd-g21-1096286-oatly-uk-ltd.html";

describe("ASA (UK) adapter on real recorded pages (5.1)", () => {
  it("builds the search URL from the brand without its legal suffix", () => {
    expect(asaUk.searchUrl("Oatly AB")).toBe(OATLY_SEARCH);
    expect(asaUk.searchUrl("Northwind Outdoor Ltd.")).toBe("https://www.asa.org.uk/search.html?q=Northwind%20Outdoor");
  });

  it("parses the recorded search page into ruling URLs only (news and guidance hits are ignored)", () => {
    const hits = parseAsaSearch(source(OATLY_SEARCH).body, OATLY_SEARCH);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]).toEqual({ url: OATLY_RULING, title: "Oatly UK Ltd t/a Oatly", date: "2022-01-26", outcomeText: "Upheld in part" });
    for (const h of hits) expect(new URL(h.url).pathname).toMatch(/^\/rulings\/.+\.html$/);
  });

  it("parses the recorded ruling page into title, advertiser, date and outcome, all non-empty", () => {
    const { body, capturedAt } = source(OATLY_RULING);
    const r = parseAsaRuling(body, OATLY_RULING, capturedAt);
    expect(r.title).toBe("ASA Ruling on Oatly UK Ltd t/a Oatly");
    expect(r.advertiser).toBe("Oatly UK Ltd t/a Oatly");
    expect(r.date).toBe("2022-01-26");
    expect(r.outcome).toBe("upheld");
    expect(r.note).toBe("upheld in part");
    expect(r.outcomeText).toBe("Upheld in part");
    expect(r.excerpt.length).toBeGreaterThan(50);
    expect(r.excerpt.length).toBeLessThanOrEqual(300);
    expect(r.excerpt).toMatch(/^Five issues were investigated/);
    expect(r.fetchedAt).toBe(capturedAt);
  });

  it("a search with no result parses to an empty list; a page without the results structure is a parse failure", () => {
    const url = "https://www.asa.org.uk/search.html?q=Mammut";
    expect(parseAsaSearch(source(url).body, url)).toEqual([]);
    expect(() => parseAsaSearch("<html><body><p>Hang tight</p></body></html>", url)).toThrow(RegulatorParseError);
    expect(() => parseAsaRuling("<html><h1>Something else</h1></html>", OATLY_RULING, "2026-10-20T00:00:00Z")).toThrow(RegulatorParseError);
  });

  it("maps the ASA outcome words", () => {
    expect(asaOutcome("Upheld")).toEqual({ outcome: "upheld" });
    expect(asaOutcome("Upheld in part")).toEqual({ outcome: "upheld", note: "upheld in part" });
    expect(asaOutcome("Not upheld")).toEqual({ outcome: "not_upheld" });
    expect(asaOutcome("Not Upheld")).toEqual({ outcome: "not_upheld" });
    expect(asaOutcome("Informally resolved")).toEqual({ outcome: "informally_resolved" });
    expect(asaOutcome("Television")).toEqual({ outcome: "unknown" });
  });
});
