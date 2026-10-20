import { describe, expect, it } from "vitest";
import { excerptOf, mergeStats, scanPage } from "@/lib/claims/engine";
import { assertReceipt } from "@/lib/pipeline/signal";

const META = { url: "https://www.northwind-outdoor.example/our-footprint/", fetchedAt: "2026-10-20T00:00:00.000Z" };
const TEXT = [
  "Our footprint",
  "Our jackets are made with eco-friendly materials and our products are better for the planet.",
  "We are carbon neutral.",
  "In fiscal year 2025 our total footprint was 186,000 tCO2e across scopes 1, 2 and 3.",
  "Our packaging is 100% sustainable and completely natural.",
  "We will be net zero across our entire business by 2040.",
  "The rest of this page explains where our emissions come from and what we still have to do about them.",
].join("\n");

describe("claim engine", () => {
  it("per-1,000-word rates are the same when the text is duplicated 3× (3.3)", () => {
    const once = scanPage(TEXT, META).stats;
    const thrice = scanPage([TEXT, TEXT, TEXT].join("\n"), META).stats;
    expect(thrice.wordCount).toBe(once.wordCount * 3);
    expect(thrice.matches).toBe(once.matches * 3);
    expect(Math.abs(thrice.per1000 - once.per1000)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(thrice.unsupportedPer1000 - once.unsupportedPer1000)).toBeLessThanOrEqual(0.01);
    for (const id of Object.keys(once.byRule) as (keyof typeof once.byRule)[]) {
      expect(Math.abs(thrice.byRule[id].per1000 - once.byRule[id].per1000)).toBeLessThanOrEqual(0.01);
    }
  });

  it("duplicated sentences count every time but give one signal per rule", () => {
    const once = scanPage(TEXT, META);
    const thrice = scanPage([TEXT, TEXT, TEXT].join("\n"), META);
    expect(thrice.signals.map((s) => s.id)).toEqual(once.signals.map((s) => s.id));
  });

  it("rate = matches × 1000 / words, per family", () => {
    const { stats } = scanPage(TEXT, META);
    expect(stats.per1000).toBeCloseTo((stats.matches * 1000) / stats.wordCount, 10);
    expect(stats.byRule.vague.matches).toBe(1);
    expect(stats.byRule.offset.matches).toBe(1);
    expect(stats.byRule.absolute.matches).toBe(1);
    expect(stats.byRule.baseline_less_comparison.matches).toBe(1);
    expect(stats.byRule.future_only.matches).toBe(1);
  });

  it("signals carry a receipt from the page record, the matched sentence as excerpt, and llm_used false", () => {
    const { signals } = scanPage(TEXT, META);
    expect(signals.length).toBe(5);
    for (const s of signals) {
      assertReceipt(s);
      expect(s.axis).toBe("claims");
      expect(s.source_url).toBe(META.url);
      expect(s.fetched_at).toBe(META.fetchedAt);
      expect(s.llm_used).toBe(false);
      expect(TEXT).toContain(s.excerpt);
      expect(["claim.supported", "claim.unsupported"]).toContain(s.kind);
    }
  });

  it("empty text gives zero rates, not NaN", () => {
    const { stats, signals } = scanPage("", META);
    expect(signals).toEqual([]);
    expect(stats.per1000).toBe(0);
  });

  it("mergeStats sums counts and recomputes rates over the total word count", () => {
    const a = scanPage(TEXT, META).stats;
    const b = scanPage("Plain words without any claim at all in them, just text about mountains and rope.", META).stats;
    const m = mergeStats([a, b]);
    expect(m.wordCount).toBe(a.wordCount + b.wordCount);
    expect(m.matches).toBe(a.matches);
    expect(m.per1000).toBeCloseTo((a.matches * 1000) / (a.wordCount + b.wordCount), 10);
  });

  it("excerpts are at most 300 characters and keep the matched phrase in view", () => {
    const long = `${"Mountains are high and the air is thin up there. ".repeat(10)}Our jackets are eco-friendly and ${"warm ".repeat(40)}`;
    const e = excerptOf(long, long.indexOf("eco-friendly"));
    expect(e.length).toBeLessThanOrEqual(300);
    expect(e).toContain("eco-friendly");
    expect(excerptOf("Short.", 0)).toBe("Short.");
  });
});
