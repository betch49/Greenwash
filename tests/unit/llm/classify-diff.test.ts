// PLAN criterion 7.3: redesign removes the Phase 4 candidate; claim_removed keeps it with llm_used: true; unsure halves weight_hint.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunOutputsRepo } from "@/lib/db/run-outputs-repo";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import { applyClassification, classifyInput } from "@/lib/llm/classify-diff";
import type { LLMRequest } from "@/lib/llm/client";
import { runPipeline } from "@/lib/pipeline/run";
import { claimsStep } from "@/lib/pipeline/steps/claims";
import { discoverStep } from "@/lib/pipeline/steps/discover";
import { fetchPagesStep } from "@/lib/pipeline/steps/fetch-pages";
import { llmClassifyStep } from "@/lib/pipeline/steps/llm";
import { waybackStep } from "@/lib/pipeline/steps/wayback";
import type { Signal } from "@/lib/pipeline/signal";
import { WEIGHTS } from "@/lib/score/weights";
import { OfflineFetcher } from "../helpers/brands";
import { tempDb } from "../helpers/db";
import { FakeLLM } from "./fake";

const NOW = () => new Date("2026-10-20T12:00:00Z");
const steps = [discoverStep, fetchPagesStep, waybackStep, claimsStep, llmClassifyStep];
const OLD = "Every Northwind jacket is climate neutral, so you can wear it with a clear conscience.";
const sentenceOf = (req: LLMRequest) => (req.input as ReturnType<typeof classifyInput>).removed_sentence;

describe("diff classification (7.3)", () => {
  let env: ReturnType<typeof tempDb>;
  let runs: RunsRepo;
  beforeEach(() => {
    env = tempDb();
    runs = new RunsRepo(env.db);
  });
  afterEach(() => env.cleanup());

  const run = (answer: (req: LLMRequest) => unknown) => {
    const r = runs.create({ query: "northwind outdoor", brand: "Northwind Outdoor Ltd.", website: "https://www.northwind-outdoor.example" });
    const llm = new FakeLLM(answer);
    return runPipeline(r, { runs, pages: new RunPagesRepo(env.db), outputs: new RunOutputsRepo(env.db), fetcher: new OfflineFetcher(), now: NOW, steps, llm }).then((out) => ({ out, llm }));
  };
  const removed = (signals: Signal[]) => signals.filter((s) => s.kind === "claim.removed");

  it("redesign ⇒ the candidate's signal is dropped, and the timeline no longer lists it as removed", async () => {
    const { out } = await run((req) => ({ classification: sentenceOf(req) === OLD ? "redesign" : "claim_removed" }));
    expect(removed(out.signals).map((s) => s.excerpt)).toEqual(["Our dyes are eco-friendly and kind to rivers."]);
    expect(out.timeline.flatMap((t) => t.claims_removed)).toEqual(["Our dyes are eco-friendly and kind to rivers."]);
    expect(out.diff_candidates.find((c) => c.sentence === OLD)!.classification).toBe("redesign");
  });

  it("moved ⇒ dropped as well", async () => {
    const { out } = await run(() => ({ classification: "moved" }));
    expect(removed(out.signals)).toEqual([]);
  });

  it("claim_removed ⇒ kept with llm_used: true and the same receipt and weight", async () => {
    const base = await run(() => undefined);
    const { out } = await run(() => ({ classification: "claim_removed" }));
    expect(removed(out.signals)).toHaveLength(2);
    for (const s of removed(out.signals)) {
      expect(s.llm_used).toBe(true);
      const before = removed(base.out.signals).find((b) => b.id === s.id)!;
      expect({ ...s, llm_used: false }).toEqual(before);
    }
  });

  it("unsure ⇒ kept, llm_used: true, weight_hint × llm.unsureWeightMultiplier (0.5)", async () => {
    const { out } = await run(() => ({ classification: "unsure" }));
    expect(WEIGHTS.llm.unsureWeightMultiplier).toBe(0.5);
    for (const s of removed(out.signals)) expect(s).toMatchObject({ llm_used: true, weight_hint: WEIGHTS.defaultWeightHint * 0.5 });
  });

  it("no answer or a failed call ⇒ the rule-based removal stands (llm_used false); the classifier never adds a signal", async () => {
    const empty = await run(() => undefined);
    expect(removed(empty.out.signals).every((s) => !s.llm_used)).toBe(true);
    const failed = await run(() => {
      throw new Error("boom");
    });
    expect(removed(failed.out.signals)).toHaveLength(2);
    expect(removed(failed.out.signals).every((s) => !s.llm_used)).toBe(true);
    expect(failed.out.progress.find((p) => p.step === "Classifying archived changes (AI)")!.status).toBe("skipped");
    // The input is the two excerpts only: no URL.
    const inputs = empty.llm.requests.filter((r) => r.name === "classify-diff").map((r) => r.input);
    expect(inputs).toHaveLength(2);
    expect(JSON.stringify(inputs)).not.toMatch(/https?:/);
  });

  it("applyClassification is a pure keep / halve / drop", () => {
    const s = { id: "x", axis: "track", kind: "claim.removed", label: "l", weight_hint: 1, source_url: "https://web.archive.org/x", fetched_at: "2026-01-01T00:00:00Z", excerpt: "e", llm_used: false } as Signal;
    expect(applyClassification(s, "redesign")).toEqual({ action: "drop" });
    expect(applyClassification(s, "claim_removed")).toEqual({ action: "keep", signal: { ...s, llm_used: true } });
    expect(applyClassification(s, "unsure")).toEqual({ action: "keep", signal: { ...s, llm_used: true, weight_hint: 0.5 } });
    expect(applyClassification(s, undefined)).toEqual({ action: "unchanged" });
  });
});
