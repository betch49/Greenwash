// PLAN criterion 7.2 and deliverable 3: the LLM proposes, the rule engine decides, no URL is ever introduced,
// and LLM-accepted sentences are never double-counted in ClaimStats (Phase 6 review carry-forward).
import { describe, expect, it } from "vitest";
import { classify, scanPage } from "@/lib/claims/engine";
import { applyExtraction, extractClaims, extractInput } from "@/lib/llm/extract";
import { claimStatsPoints, score } from "@/lib/score/scorer";
import { WEIGHTS } from "@/lib/score/weights";
import type { FetchedPage } from "@/lib/discover/fetch-pages";
import { loadBrandPage, NORTHWIND } from "../helpers/brands";
import { FakeLLM } from "./fake";

const page = (text: string, url = "https://a.example/impact"): FetchedPage => ({ url, via: "heuristic", title: "Impact", text, wordCount: 1200, links: [], fetchedAt: "2026-10-20T00:00:00.000Z", source: "fixture", contentHash: "h" });

describe("LLM claim extraction (7.2)", () => {
  it("output signals carry only the source_url of the page they came from, whatever URL the model writes", async () => {
    const p = page("Our story\nOur packaging is eco-friendly, see https://evil.example/proof.\nWe make jackets.");
    const llm = new FakeLLM(() => ({
      claims: [
        { sentence: "Our packaging is eco-friendly, see https://evil.example/proof.", kind_hint: "vague" },
        { sentence: "Our packaging is eco-friendly", kind_hint: "vague", source_url: "https://evil.example/" },
      ],
    }));
    const out = await extractClaims(llm, p, { allowedUrls: [p.url], ruleHits: [] });
    expect(out.signals.length).toBeGreaterThan(0);
    for (const s of out.signals) {
      expect(s.source_url).toBe(p.url);
      expect(s.llm_used).toBe(true);
    }
    expect(out.dropped.map((d) => d.reason.split(" (")[0])).toEqual(["invalid item"]);
    // The input is the page text and the fetched-URL list only.
    expect(llm.requests[0].input).toEqual(extractInput(p, [p.url]));
  });

  it("the rule engine decides: a proposal no claim rule matches is dropped", () => {
    const out = applyExtraction({ claims: [{ sentence: "We make jackets.", kind_hint: "other" }] }, page("We make jackets."), { allowedUrls: [], ruleHits: [] });
    expect(out.signals).toEqual([]);
    expect(out.dropped).toEqual([{ sentence: "We make jackets.", reason: "no claim rule matches" }]);
  });

  it("a proposal the rules already found adds nothing: the deterministic signal wins (llm_used false stays)", () => {
    const p = page("Our story\nOur packaging is eco-friendly.");
    const rules = scanPage(p.text, { url: p.url, fetchedAt: p.fetchedAt });
    expect(rules.hits).toHaveLength(1);
    const out = applyExtraction({ claims: [{ sentence: "Our packaging is eco-friendly.", kind_hint: "vague" }] }, p, { allowedUrls: [p.url], ruleHits: rules.hits });
    expect(out.signals).toEqual([]);
    expect(out.confirmed).toEqual(["Our packaging is eco-friendly."]);
  });

  it("uses the page's own context: a target followed by a progress figure stays unmatched, as in the page scan", () => {
    const text = "We will halve our emissions by 2030.\nSince 2019 we have cut our emissions by 18 percent, from 12,000 tCO2e to 9,840 tCO2e.";
    const rules = scanPage(text, { url: "https://a.example/impact", fetchedAt: "2026-10-20T00:00:00.000Z" });
    const out = applyExtraction({ claims: [{ sentence: "We will halve our emissions by 2030.", kind_hint: "future_only" }] }, page(text), { allowedUrls: [], ruleHits: rules.hits });
    // Alone, the sentence would match; with its next sentence (a progress figure) it does not.
    expect(classify("We will halve our emissions by 2030.").map((m) => m.ruleId)).toContain("future_only");
    expect(rules.hits.filter((h) => h.ruleId === "future_only")).toEqual([]);
    expect(out.signals.filter((s) => s.excerpt.startsWith("We will halve"))).toEqual([]);
  });

  it("the same sentence proposed on two pages gives one signal", () => {
    const keys = new Set<string>();
    const a = applyExtraction({ claims: [{ sentence: "Our packaging is eco-friendly.", kind_hint: "vague" }] }, page("Our packaging is eco-friendly.", "https://a.example/1"), { allowedUrls: [], ruleHits: [], acceptedKeys: keys });
    const b = applyExtraction({ claims: [{ sentence: "Our packaging is eco-friendly.", kind_hint: "vague" }] }, page("Our packaging is eco-friendly.", "https://a.example/2"), { allowedUrls: [], ruleHits: [], acceptedKeys: keys });
    expect(a.signals).toHaveLength(1);
    expect(b.signals).toEqual([]);
    expect(b.dropped[0].reason).toBe("duplicate");
  });

  it("LLM-accepted sentences are not in ClaimStats: the scorer counts their points once, on top of the rule counts, and they show in ai_share", () => {
    const fixture = loadBrandPage(NORTHWIND.slug, NORTHWIND.sustainabilityPage, NORTHWIND.sustainabilityUrl);
    const rules = scanPage(fixture.text, { url: fixture.url, fetchedAt: fixture.fetchedAt });
    const statsBefore = JSON.stringify(rules.stats);
    // Pretend the rules missed one of their own sentences, so the LLM path adds it.
    const missed = rules.hits.find((h) => !h.supported)!;
    const others = rules.hits.filter((h) => h.sentence !== missed.sentence);
    const out = applyExtraction({ claims: [{ sentence: missed.sentence, kind_hint: missed.ruleId }] }, fixture, { allowedUrls: [fixture.url], ruleHits: others });
    expect(out.signals.length).toBeGreaterThan(0);
    expect(JSON.stringify(rules.stats)).toBe(statsBefore);
    const stats = { matches: 4, unsupported: 4, wordCount: 1000 };
    const base = score({ signals: [], words_scanned: 1000, step_status: {}, archived_snapshots: 0, claim_stats: stats }, { mode: "prod" });
    const withLlm = score({ signals: out.signals, words_scanned: 1000, step_status: {}, archived_snapshots: 0, claim_stats: stats }, { mode: "prod" });
    const claims = (r: typeof base) => r.axes.find((a) => a.id === "claims")!.subscore;
    const perPoint = (WEIGHTS.claimsRate.perWords / 1000) * WEIGHTS.claimsRate.subscorePerPointPer1000Words;
    expect(claims(base)).toBe(claimStatsPoints(stats) * perPoint);
    expect(claims(withLlm) - claims(base)).toBeCloseTo(out.signals.reduce((n, s) => n + (WEIGHTS.points.claims[s.kind as "claim.unsupported"] ?? 0), 0) * perPoint, 6);
    expect(withLlm.ai_share).toBeGreaterThan(0);
    expect(withLlm.ai_share).toBeLessThanOrEqual(0.5);
    expect(withLlm.llm_signal_ids).toEqual(out.signals.map((s) => s.id));
  });
});
