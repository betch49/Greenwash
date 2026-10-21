import { describe, expect, it } from "vitest";
import { parseCasePage, partiesFromTitle, SabinParseError } from "@/lib/registries/sabin";
import { DOC, sabinPage } from "./sabin-helpers";

describe("Sabin document-page parser (13.1)", () => {
  it.each(Object.values(DOC))("recorded page %s ⇒ title, summary, filed year, status, ≥ 1 geography", (url) => {
    const { body, capturedAt } = sabinPage(url);
    const c = parseCasePage(body, url, capturedAt);
    expect(c.title.length).toBeGreaterThan(0);
    expect(c.summary.length).toBeGreaterThan(50);
    expect(c.filed_year).toBeGreaterThanOrEqual(2015);
    expect(c.status.length).toBeGreaterThan(0);
    expect(c.geographies.length).toBeGreaterThanOrEqual(1);
    expect(c.fetchedAt).toBe(capturedAt);
    expect(c.last_event).toMatch(/\(\d{4}-\d{2}-\d{2}\)$/);
  });

  it("the TotalEnergies greenwashing case: values as published", () => {
    const { body, capturedAt } = sabinPage(DOC.total);
    const c = parseCasePage(body, DOC.total, capturedAt);
    expect(c).toMatchObject({
      title: "Greenpeace France and Others v. TotalEnergies SE and TotalEnergies Electricité et Gaz France",
      filed_year: 2022,
      filed_date: "2022-01-01",
      status: "Decided",
      last_event: "Decision (2025-10-23)",
      geographies: ["France"],
    });
    expect(c.parties_from_title).toEqual(["Greenpeace France", "Others", "TotalEnergies SE", "TotalEnergies Electricité et Gaz France"]);
  });

  it("party parsing: v., et al., commas, and; parenthesised nicknames dropped", () => {
    expect(partiesFromTitle("Milieudefensie et al. v. Royal Dutch Shell plc.")).toEqual(["Milieudefensie", "Royal Dutch Shell plc."]);
    expect(partiesFromTitle("Milieudefensie et al. v. Shell plc (No New Oil and Gas Fields Case)")).toEqual(["Milieudefensie", "Shell plc"]);
    expect(partiesFromTitle("Aurora v Sweden (Aurora Case)")).toEqual(["Aurora", "Sweden"]);
    expect(partiesFromTitle("ANVR, TUI, D-reizen, and Prijsvrij vs. The Hague")).toEqual(["ANVR", "TUI", "D-reizen", "Prijsvrij", "The Hague"]);
  });

  it("a page without __NEXT_DATA__ family ⇒ SabinParseError naming the URL; no status ⇒ “unknown”", () => {
    expect(() => parseCasePage("<html><body>maintenance</body></html>", DOC.total, "2026-10-21T00:00:00Z")).toThrow(SabinParseError);
    expect(() => parseCasePage("<html></html>", DOC.total, "2026-10-21T00:00:00Z")).toThrow(`case page could not be parsed (${DOC.total})`);
    const bare = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { family: { title: "A v. B", summary: "", events: [], metadata: {}, geographies: [] } } } })}</script>`;
    expect(parseCasePage(bare, DOC.total, "2026-10-21T00:00:00Z")).toMatchObject({ status: "unknown", last_event: "unknown", filed_year: null });
  });
});
