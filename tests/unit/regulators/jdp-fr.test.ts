import { describe, expect, it } from "vitest";
import { RegulatorParseError, parseDayMonthYear } from "@/lib/regulators/adapter";
import { jdpFr, jdpOutcome, parseJdpDecision, parseJdpSearch } from "@/lib/regulators/jdp-fr";
import { source } from "../helpers/sources";

// TotalEnergies is a regulator-only case: a real JDP search and real decision pages
// (none of the three fixture brands has a JDP decision; their empty searches are recorded too).
const SEARCH = "https://www.jdp-pub.org/avis/?search_avis=TotalEnergies";
const UPHELD = "https://www.jdp-pub.org/avis/totalenergies-internet/";
const REJECTED = "https://www.jdp-pub.org/avis/totalenergies-presse/";

describe("JDP (France) adapter on real recorded pages (5.2)", () => {
  it("builds the listing search URL", () => {
    // ADR-037: "SE" is an ADR-019 legal suffix, stripped from the search query.
    expect(jdpFr.searchUrl("TotalEnergies SE")).toBe(SEARCH);
    expect(jdpFr.searchUrl("Oatly AB")).toBe("https://www.jdp-pub.org/avis/?search_avis=Oatly");
  });

  it("parses the recorded listing into decision URLs with title, date and outcome words", () => {
    const hits = parseJdpSearch(source(SEARCH).body, SEARCH);
    expect(hits.map((h) => h.url)).toEqual([UPHELD, REJECTED, "https://www.jdp-pub.org/avis/total-energies-internet/"]);
    expect(hits[0]).toEqual({ url: UPHELD, title: "TOTALENERGIES", date: "2024-12-11", outcomeText: "Plainte fondée après révision" });
  });

  it("parses a recorded decision page into title, advertiser, date and outcome, all non-empty", () => {
    const { body, capturedAt } = source(UPHELD);
    const r = parseJdpDecision(body, UPHELD, capturedAt);
    expect(r).toMatchObject({ title: "TOTALENERGIES", advertiser: "TOTALENERGIES", date: "2024-12-11", outcome: "upheld", outcomeText: "Plainte fondée après révision" });
    expect(r.excerpt).toMatch(/^Le Jury de Déontologie Publicitaire a été saisi, le 15 juin 2024/);
    expect(r.excerpt.length).toBeLessThanOrEqual(300);
    const rejected = parseJdpDecision(source(REJECTED).body, REJECTED, capturedAt);
    expect(rejected).toMatchObject({ date: "2024-01-02", outcome: "not_upheld", outcomeText: "Plainte rejetée" });
  });

  it("maps fondée / non fondée / partiellement fondée (PLAN deliverable 2)", () => {
    expect(jdpOutcome("Plainte fondée")).toEqual({ outcome: "upheld" });
    expect(jdpOutcome("Plaintes fondées")).toEqual({ outcome: "upheld" });
    expect(jdpOutcome("Plainte non fondée")).toEqual({ outcome: "not_upheld" });
    expect(jdpOutcome("Plaintes non fondées")).toEqual({ outcome: "not_upheld" });
    expect(jdpOutcome("Plainte partiellement fondée")).toEqual({ outcome: "upheld", note: "partiellement fondée" });
    expect(jdpOutcome("Plainte rejetée")).toEqual({ outcome: "not_upheld" });
    // The brand's appeal was rejected; the complaint itself stands.
    expect(jdpOutcome("Plainte fondée / Demande de révision rejetée")).toEqual({ outcome: "upheld" });
    expect(jdpOutcome("Internet")).toEqual({ outcome: "unknown" });
  });

  it("an empty recorded search parses to []; a page with neither cards nor the search form is a parse failure", () => {
    const url = "https://www.jdp-pub.org/avis/?search_avis=Oatly";
    expect(parseJdpSearch(source(url).body, url)).toEqual([]);
    expect(() => parseJdpSearch("<html><body>maintenance</body></html>", url)).toThrow(RegulatorParseError);
  });

  it("parses English and French dates", () => {
    expect(parseDayMonthYear("26 January 2022")).toBe("2022-01-26");
    expect(parseDayMonthYear("Avis publié le 11 décembre 2024")).toBe("2024-12-11");
    expect(parseDayMonthYear("1er février 2023")).toBe("2023-02-01");
    expect(parseDayMonthYear("no date")).toBeNull();
  });
});
