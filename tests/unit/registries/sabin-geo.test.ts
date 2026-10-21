import { describe, expect, it } from "vitest";
import { parseGeographyPage, SabinParseError } from "@/lib/registries/sabin";
import { GEO, sabinPage } from "./sabin-helpers";

describe("Sabin geography-page parser (13.2)", () => {
  it("France: the 4 server-rendered families with slug and title; document URL = /document/<family_slug>", () => {
    const url = GEO("france");
    const fams = parseGeographyPage(sabinPage(url).body, url);
    expect(fams).toHaveLength(4);
    expect(fams.map((f) => f.title)).toContain("ClientEarth v. BlackRock");
    for (const f of fams) {
      expect(f.slug).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
      expect(f.url).toBe(`https://www.climatecasechart.com/document/${f.slug}`);
    }
    expect(fams.find((f) => f.title === "ClientEarth v. BlackRock")?.slug).toBe("clientearth-v-blackrock_51f1");
  });

  it.each(["switzerland", "netherlands", "sweden", "united-kingdom", "united-states-of-america"])("%s: every recorded listing parses to at most 4 families", (slug) => {
    const fams = parseGeographyPage(sabinPage(GEO(slug)).body, GEO(slug));
    expect(fams.length).toBeGreaterThanOrEqual(1);
    expect(fams.length).toBeLessThanOrEqual(4);
  });

  it("a page without the listing ⇒ SabinParseError", () => {
    expect(() => parseGeographyPage("<html></html>", GEO("france"))).toThrow(SabinParseError);
  });
});
