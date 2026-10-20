import { describe, expect, it } from "vitest";
import { evaluateEvidence, reportYear, type EvidencePage } from "@/lib/claims/evidence-rules";
import { assertReceipt } from "@/lib/pipeline/signal";
import { BRANDS, NORTHWIND, loadBrandPages } from "../helpers/brands";

const page = (over: Partial<EvidencePage> = {}): EvidencePage => ({
  url: "https://www.northwind-outdoor.example/about/",
  title: "About",
  text: "We make gear.",
  links: [],
  fetchedAt: "2026-10-20T00:00:00.000Z",
  ...over,
});
const link = (text: string, href: string, region: "content" | "chrome" = "content") => ({ text, href, region });
const kinds = (pages: EvidencePage[]) => evaluateEvidence(pages).signals.map((s) => s.kind);

describe("evidence rules on the fixture brands (3.5)", () => {
  const results = BRANDS.map((b) => ({ slug: b.slug, res: evaluateEvidence(loadBrandPages(b.slug)) }));

  it("at least one brand yields impact_report_link with a year", () => {
    const withYear = results.filter(({ res }) => res.reportLinks.some((r) => r.year !== null));
    expect(withYear.length).toBeGreaterThanOrEqual(1);
    const found = results.flatMap(({ res }) => res.signals).filter((s) => s.kind === "evidence.report_found");
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0].label).toMatch(/\(20\d\d\)/);
  });

  it("at least one brand yields labels_claimed", () => {
    expect(results.some(({ res }) => res.labels_claimed.length > 0)).toBe(true);
    const fairphone = results.find((r) => r.slug === "fairphone")!.res;
    expect(fairphone.labels_claimed.map((l) => l.name)).toContain("Fairtrade");
  });

  it("labels_claimed never appears in scored signals; each label is a could-not-check entry", () => {
    for (const { res } of results) {
      for (const s of res.signals) {
        expect(s.kind).not.toMatch(/label/i);
        expect(s.label).not.toMatch(/label claimed/i);
        assertReceipt(s);
        expect(s.llm_used).toBe(false);
        expect(s.axis).toBe("evidence");
      }
      expect(res.could_not_check).toHaveLength(res.labels_claimed.length);
      for (const l of res.labels_claimed) {
        expect(res.could_not_check).toContain(`${l.name}: label claimed on page; not verified in v1 (${l.url}).`);
      }
    }
  });

  it("the fictional fixture exercises every rule: labels, dated report, absolute emissions, supplier list", () => {
    const res = evaluateEvidence(loadBrandPages(NORTHWIND.slug));
    expect(res.labels_claimed.map((l) => l.name)).toEqual(expect.arrayContaining(["GOTS", "B Corp", "bluesign", "1% for the Planet"]));
    expect(res.signals.map((s) => s.kind).sort()).toEqual([
      "evidence.absolute_emissions_found",
      "evidence.report_found",
      "evidence.supplier_list_found",
    ]);
    expect(res.signals.find((s) => s.kind === "evidence.absolute_emissions_found")!.excerpt).toContain("186,000 tCO2e");
  });
});

describe("impact_report_link", () => {
  it("a dated report more than 2 years before the fetch year ⇒ evidence.stale_report", () => {
    expect(kinds([page({ links: [link("Sustainability report 2022", "https://x.example/sr.pdf")] })])).toEqual(["evidence.stale_report"]);
    expect(kinds([page({ links: [link("Sustainability report 2024", "https://x.example/sr.pdf")] })])).toEqual(["evidence.report_found"]);
  });

  it("the newest year across pages wins", () => {
    const k = kinds([
      page({ links: [link("Impact report 2019", "https://x.example/a.pdf")] }),
      page({ url: "https://www.northwind-outdoor.example/b/", links: [link("Read", "https://x.example/impact-report-2025.pdf")] }),
    ]);
    expect(k).toEqual(["evidence.report_found"]);
  });

  it("no report link at all ⇒ evidence.no_report_found with the scanned pages as excerpt", () => {
    const res = evaluateEvidence([page({ title: "About" }), page({ url: "https://www.northwind-outdoor.example/c/", title: "Care" })]);
    expect(res.signals.map((s) => s.kind)).toEqual(["evidence.no_report_found"]);
    expect(res.signals[0].excerpt).toBe("Pages scanned: About; Care");
    assertReceipt(res.signals[0]);
  });

  it("a report page link without a year or PDF is not a report link; an undated PDF is", () => {
    expect(kinds([page({ links: [link("Our impact", "https://x.example/impact/")] })])).toEqual(["evidence.no_report_found"]);
    expect(kinds([page({ links: [link("Impact report", "https://x.example/impact.pdf")] })])).toEqual(["evidence.report_found_undated"]);
  });

  it("year: link text first, then file name, then path; future years ignored", () => {
    expect(reportYear("Read the full report", "https://x.example/uploads/2026/04/Impact_Report-2025.pdf", 2026)).toBe(2025);
    expect(reportYear("Sustainability Update 2025", "https://x.example/static/abc", 2026)).toBe(2025);
    expect(reportYear("Report", "https://x.example/report-fy2024.pdf", 2026)).toBe(2024);
    expect(reportYear("Targets for 2030", "https://x.example/r.pdf", 2026)).toBeNull();
  });

  it("no pages ⇒ no signals", () => {
    expect(evaluateEvidence([]).signals).toEqual([]);
  });
});

describe("absolute_emissions_present and supplier_list_present", () => {
  it("number + tCO2e / tonnes CO2e / t CO2 is found; avoided or per-unit figures are not", () => {
    expect(kinds([page({ text: "Our 2025 footprint was 12,400 tonnes CO2e." })])).toContain("evidence.absolute_emissions_found");
    expect(kinds([page({ text: "Scope 1 and 2: 310 t CO2 in 2024." })])).toContain("evidence.absolute_emissions_found");
    expect(kinds([page({ text: "We avoided 2,083 tons of CO₂e in 2025." })])).not.toContain("evidence.absolute_emissions_found");
    expect(kinds([page({ text: "Each phone is 29 kg CO₂e." })])).not.toContain("evidence.absolute_emissions_found");
  });

  it("a link named supplier list / factory list is found", () => {
    expect(kinds([page({ links: [link("Our supplier list", "https://x.example/s.pdf")] })])).toContain("evidence.supplier_list_found");
    expect(kinds([page({ links: [link("Our suppliers", "https://x.example/s")] })])).not.toContain("evidence.supplier_list_found");
  });
});
