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

describe("targets are not evidence (3.2, ADR-014)", () => {
  it("'We are carbon neutral.' followed by two target sentences IS unsupported", () => {
    const k = scanPage("We are carbon neutral. We will be net zero by 2040. We aim to cut emissions by 2030.", META).signals;
    const offset = k.find((s) => s.excerpt === "We are carbon neutral.")!;
    expect(offset.kind).toBe("claim.unsupported");
  });

  it("a founding year is not evidence: 'Our jackets are eco-friendly. Founded in 1998, we make gear.' IS unsupported", () => {
    expect(kinds("Our jackets are eco-friendly. Founded in 1998, we make gear.")).toEqual(["claim.unsupported"]);
  });

  it("a collection year is not evidence", () => {
    expect(kinds("We are the most sustainable brand. Shop the 2025 collection.")).toEqual(["claim.unsupported"]);
  });

  it("a future_only hit's own figure is its target: 'We are committed to 100% renewable electricity.' IS unsupported", () => {
    expect(kinds("We are committed to 100% renewable electricity.")).toEqual(["claim.unsupported"]);
  });

  it("'We will be a sustainable company by 2030.' gives two unsupported hits", () => {
    const { signals } = scanPage("We will be a sustainable company by 2030.", META);
    expect(signals.map((s) => [s.id.split("-")[1], s.kind])).toEqual([
      ["vague", "claim.unsupported"],
      ["future_only", "claim.unsupported"],
    ]);
  });

  it("'We are carbon neutral. Our stores are bright. Our emissions were 1,200 tCO2e.' is supported", () => {
    expect(kinds("We are carbon neutral. Our stores are bright. Our emissions were 1,200 tCO2e.")).toEqual(["claim.supported"]);
  });

  it("a year is recorded only next to a figure and never after a target preposition", () => {
    const m = (t: string) => findSubstantiation([t], 0, []).markers.map((x) => `${x.kind}:${x.text}`);
    expect(m("Founded in 1998.")).toEqual([]);
    expect(m("In 2024 we cut emissions by 41%.")).toEqual(["number_unit:41%", "year:2024"]);
    expect(m("We cut 41% of emissions, on track until 2030.")).toEqual(["number_unit:41%"]);
    expect(findSubstantiation(["Founded in 1998."], 0, []).supported).toBe(false);
  });

  it("a window sentence that is itself a future_only target contributes no marker, not even a certifier", () => {
    expect(kinds("Our cotton is sustainable. We will switch to GOTS cotton for our waste-free range by 2030.")).toEqual(
      expect.arrayContaining(["claim.unsupported"]),
    );
    const sub = findSubstantiation(["Our cotton is sustainable.", "We will be net zero by 2040 with 50% renewable energy."], 0, [[11, 22]]);
    expect(sub.markers).toEqual([]);
  });

  it("a future_only hit keeps certifier and report-link markers in its own sentence", () => {
    expect(kinds("We aim to make all our packaging FSC certified.")).toEqual(["claim.supported"]);
  });
});

