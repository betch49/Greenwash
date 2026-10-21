// PLAN criterion 7.1: item-wise validation; an invalid payload is an empty result and a skipped entry, never a throw.
import { describe, expect, it } from "vitest";
import { applyExtraction, extractClaims } from "@/lib/llm/extract";
import { classifyDiff } from "@/lib/llm/classify-diff";
import { checkSummary } from "@/lib/llm/summary";
import { validateItems } from "@/lib/llm/validate";
import { ExtractItemSchema } from "@/lib/llm/extract";
import { runPipeline } from "@/lib/pipeline/run";
import { RunsRepo } from "@/lib/db/runs-repo";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import type { DiffCandidate } from "@/lib/wayback/retraction";
import { OfflineFetcher } from "../helpers/brands";
import { tempDb } from "../helpers/db";
import { FakeLLM } from "./fake";

const PAGE = {
  url: "https://a.example/sustainability",
  fetchedAt: "2026-10-20T00:00:00.000Z",
  links: [],
  text: "Our story\nOur packaging is eco-friendly.\nWe make rain jackets in Portugal.",
};
const ctx = { allowedUrls: [PAGE.url], ruleHits: [] };

describe("schema validation of LLM outputs (7.1)", () => {
  it("drops an item with an extra field, an item with a wrong type and a non-substring sentence; keeps the valid one", () => {
    const out = applyExtraction(
      {
        claims: [
          { sentence: "Our packaging is eco-friendly.", kind_hint: "vague" },
          { sentence: "Our packaging is eco-friendly.", kind_hint: "vague", url: "https://elsewhere.example/" },
          { sentence: 42, kind_hint: "vague" },
          { sentence: "Our packaging is compostable and eco-friendly.", kind_hint: "vague" },
          { sentence: "We make rain jackets in Portugal.", kind_hint: "nonsense" },
        ],
      },
      PAGE,
      ctx,
    );
    expect(out.valid).toBe(true);
    expect(out.signals).toHaveLength(1);
    expect(out.signals[0].excerpt).toBe("Our packaging is eco-friendly.");
    expect(out.dropped.map((d) => d.reason.split(" (")[0])).toEqual(["invalid item", "invalid item", "invalid item", "not verbatim in the page text"]);
  });

  it("validateItems: payload not an object, wrong key, extra top-level field, list not a list ⇒ invalid", () => {
    for (const bad of [null, "text", [], { claim: [] }, { claims: [], note: "x" }, { claims: "a" }]) {
      expect(validateItems(bad, "claims", ExtractItemSchema).ok).toBe(false);
    }
    expect(validateItems({ claims: [] }, "claims", ExtractItemSchema)).toEqual({ ok: true, items: [], dropped: [] });
  });

  it("a fully invalid extraction payload ⇒ empty result with a problem, never a throw", async () => {
    const out = await extractClaims(new FakeLLM(() => ({ sentences: ["x"] })), { ...PAGE, via: "heuristic", title: "t", wordCount: 10, source: "fixture", contentHash: "h" }, ctx);
    expect(out.signals).toEqual([]);
    expect(out.problem).toContain("unexpected field");
    expect(out.log).toEqual({ name: "extract", used_fixture: false, status: "invalid" });
  });

  it("classification: unknown value or extra field ⇒ invalid, no classification", async () => {
    const cand = { signalId: "s", pageUrl: "p", sentence: "x", ruleIds: [], from: { timestamp: "20240101000000", snapshotUrl: "u", before: [], after: [] }, to: { timestamp: "20250101000000", snapshotUrl: "v", nearest: null, nearestSimilarity: 0, context: [] }, classification: "unclassified" } as DiffCandidate;
    for (const bad of [{ classification: "deleted" }, { classification: "redesign", why: "x" }, "redesign"]) {
      const r = await classifyDiff(new FakeLLM(() => bad), cand);
      expect(r.classification).toBeUndefined();
      expect(r.log.status).toBe("invalid");
    }
  });

  it("summary: wrong types or an extra field ⇒ rejected", () => {
    expect(checkSummary({ summary: 3, cited_urls: [] }, []).ok).toBe(false);
    expect(checkSummary({ summary: "Fine.", cited_urls: [], score: 12 }, []).ok).toBe(false);
  });

  it("in the pipeline, garbage from every LLM call ⇒ skipped lines, a done run and rule-based signals only", async () => {
    const env = tempDb();
    try {
      const runs = new RunsRepo(env.db);
      const run = runs.create({ query: "northwind outdoor", brand: "Northwind Outdoor Ltd.", website: "https://www.northwind-outdoor.example" });
      const out = await runPipeline(run, { runs, pages: new RunPagesRepo(env.db), fetcher: new OfflineFetcher(), now: () => new Date("2026-10-20T12:00:00Z"), llm: new FakeLLM(() => ({ garbage: true })) });
      expect(out.status).toBe("done");
      expect(out.signals.every((s) => !s.llm_used)).toBe(true);
      const skipped = out.progress.filter((p) => p.status === "skipped" && p.step.endsWith("(AI)"));
      expect(skipped.length).toBeGreaterThanOrEqual(3);
      expect(skipped.every((p) => p.reason!.includes("AI output rejected"))).toBe(true);
      expect(out.report!.summary).toBeUndefined();
      expect(out.report!.ai_share).toBe(0);
      expect(out.report!.skipped.some((s) => s.step === "Writing the plain-English summary (AI)")).toBe(true);
    } finally {
      env.cleanup();
    }
  });
});
