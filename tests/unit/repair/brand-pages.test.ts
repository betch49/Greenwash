import { describe, expect, it } from "vitest";
import { receiptProblem } from "@/lib/pipeline/signal";
import { evaluateRepairPages, parseWarrantyYears } from "@/lib/repair/brand-pages";

const page = (url: string, title: string, lines: string[], links: { text: string; href: string }[] = []) => ({
  url,
  title,
  text: lines.join("\n"),
  links: links.map((l) => ({ ...l, region: "content" as const })),
  fetchedAt: "2026-10-20T00:00:00.000Z",
});

describe("brand-page repair rules (5.7)", () => {
  it.each([
    ["All phones come with a 2-year warranty.", 2],
    ["Backed by our 5 year limited warranty.", 5],
    ["We offer a warranty of 3 years on every jacket.", 3],
    ["Modular design. Five-year warranty.", 5],
    ["Our 2-year quality guarantee", 2],
    ["A guarantee period of up to 10 years applies.", 10],
  ])("warranty phrasing “%s” ⇒ %s years", (text, years) => {
    expect(parseWarrantyYears(text)).toBe(years);
  });

  it("“lifetime warranty” ⇒ 'lifetime'; the longest stated warranty wins; no warranty ⇒ null", () => {
    expect(parseWarrantyYears("Every pack carries a lifetime warranty.")).toBe("lifetime");
    expect(parseWarrantyYears("A 2-year warranty, extendable to a 5-year warranty.")).toBe(5);
    expect(parseWarrantyYears("The warranty period starts at purchase.")).toBeNull();
    expect(parseWarrantyYears("Founded 25 years ago.")).toBeNull();
  });

  it("finds repair guides, spare parts, warranty and a repair service, one protective signal each, with page receipts", () => {
    const res = evaluateRepairPages([
      page("https://shop.example/support", "Support", ["Find a repair guide for your device.", "Spare parts are available in our parts store.", "A lifetime warranty covers the frame."]),
      page("https://shop.example/repair", "Repair", ["Send it in for repair and we fix it in 5 days."]),
    ]);
    expect(res.signals.map((s) => s.kind).sort()).toEqual(["repair.manual_found", "repair.program_found", "repair.spare_parts_found", "repair.warranty_found"]);
    const w = res.signals.find((s) => s.kind === "repair.warranty_found")!;
    expect(w.label).toBe("Lifetime warranty stated on the brand’s site");
    expect(res.findings.find((f) => f.rule === "warranty_years")!.warrantyYears).toBe("lifetime");
    expect(res.signals.find((s) => s.kind === "repair.program_found")!.source_url).toBe("https://shop.example/repair");
    for (const s of res.signals) {
      expect(receiptProblem(s)).toBeNull();
      expect(s.axis).toBe("repair");
      expect(s.llm_used).toBe(false);
    }
  });

  it("link texts count (a navigation link to the brand's parts shop)", () => {
    const res = evaluateRepairPages([page("https://shop.example/", "Home", ["Welcome."], [{ text: "Spare parts", href: "https://shop.example/spare-parts" }])]);
    expect(res.signals.map((s) => s.kind)).toEqual(["repair.spare_parts_found"]);
    expect(res.signals[0].excerpt).toBe("“Spare parts” (https://shop.example/spare-parts)");
  });

  it("pages with none ⇒ one repair.no_repair_info_found whose receipt lists the scanned URLs", () => {
    const pages = [page("https://shop.example/", "Home", ["We make jackets."]), page("https://shop.example/about", "About us", ["Founded in 1998."])];
    const res = evaluateRepairPages(pages);
    expect(res.findings).toEqual([]);
    expect(res.signals).toHaveLength(1);
    const s = res.signals[0];
    expect(s.kind).toBe("repair.no_repair_info_found");
    expect(s.source_url).toBe("https://shop.example/");
    expect(s.excerpt).toBe("Pages scanned: Home (https://shop.example/); About us (https://shop.example/about)");
    expect(res.scanned).toEqual(["https://shop.example/", "https://shop.example/about"]);
    expect(receiptProblem(s)).toBeNull();
  });

  it("no page at all ⇒ no signal (nothing was scanned)", () => {
    expect(evaluateRepairPages([]).signals).toEqual([]);
  });
});
