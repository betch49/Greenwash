import { describe, expect, it } from "vitest";
import { scanPage } from "@/lib/claims/engine";
import { findSubstantiation } from "@/lib/claims/substantiation";
import { offsetRule } from "@/lib/claims/rules/offset";

const META = { url: "https://www.northwind-outdoor.example/our-footprint/", fetchedAt: "2026-10-20T00:00:00.000Z" };
const kinds = (text: string, links = [] as { href: string; text: string; region: "content" | "chrome" }[]) =>
  scanPage(text, { ...META, links }).signals.map((s) => s.kind);

describe("same-page substantiation (3.2)", () => {
  it("'Carbon neutral since 2020: we cut scope 1–2 emissions by 41% (see our 2024 report)' is NOT claim.unsupported", () => {
    const text = "Carbon neutral since 2020: we cut scope 1–2 emissions by 41% (see our 2024 report).";
    expect(kinds(text)).not.toContain("claim.unsupported");
    // And the markers are there: a figure with a unit and years.
    const sub = findSubstantiation([text], 0, [[0, 14]]);
    expect(sub.supported).toBe(true);
    expect(sub.markers.map((m) => m.kind)).toEqual(expect.arrayContaining(["number_unit", "year"]));
  });

  it("'We are carbon neutral.' alone IS claim.unsupported", () => {
    expect(kinds("We are carbon neutral.")).toEqual(["claim.unsupported"]);
  });

  it("the claim's own wording is not its evidence: '100% sustainable' stays unsupported", () => {
    expect(kinds("Our packaging is 100% sustainable.")).toEqual(["claim.unsupported"]);
  });

  it("a target year inside the future-only claim is masked", () => {
    expect(kinds("We will be net zero by 2040.")).toEqual(["claim.unsupported"]);
  });

  it("looks at the following two sentences, not the third", () => {
    const base = "We are carbon neutral.";
    expect(kinds(`${base} Our stores are bright. Our team is large. We cut 41% of emissions.`)).toContain("claim.unsupported");
    expect(kinds(`${base} Our stores are bright. Our emissions were 1,200 tCO2e.`)).toEqual(["claim.supported"]);
  });

  it("a named standard or certifier substantiates", () => {
    expect(kinds("Our cotton is sustainable. It is certified to GOTS.")).toEqual(["claim.supported"]);
    expect(kinds("Our cotton is sustainable. It is certified by gots.")).toEqual(["claim.unsupported"]);
  });

  it("an evidence link whose text appears in the window substantiates; a chrome link does not", () => {
    const text = "Our materials are eco-friendly. See the full methodology for details.";
    expect(kinds(text, [{ href: "https://x.example/m.pdf", text: "full methodology", region: "content" }])).toEqual(["claim.supported"]);
    expect(kinds(text, [{ href: "https://x.example/m.pdf", text: "full methodology", region: "chrome" }])).toEqual(["claim.unsupported"]);
    expect(kinds(text, [{ href: "https://x.example/shop", text: "details", region: "content" }])).toEqual(["claim.unsupported"]);
  });

  it("offset rule exposes its span so substantiation can mask it", () => {
    expect(offsetRule.test("We are carbon neutral.")?.spans).toEqual([[7, 21]]);
  });
});
