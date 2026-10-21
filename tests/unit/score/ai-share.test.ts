import { describe, expect, it } from "vitest";
import { applyLlmGuard } from "@/lib/score/ai-share";
import { score } from "@/lib/score/scorer";
import { WEIGHTS } from "@/lib/score/weights";
import { ALL_DONE, randomInput, rng, signal } from "./random";

// The DoD guard test (brief Section 4, ADR-007): fails if ai_share can exceed 50% for any input.
const BRIEF_CAP = 0.5;

describe("ai_share ≤ 0.5 for every input (6.3)", () => {
  it("1,000 random signal sets: mixed, all-LLM and no-LLM sets", () => {
    const r = rng(42);
    let positive = 0;
    for (let i = 0; i < 1000; i++) {
      const mode = i % 4 === 0 ? "all" : i % 4 === 1 ? "none" : "mixed";
      const input = randomInput(r, mode);
      const res = score(input);
      expect(res.ai_share, `case ${i}`).toBeGreaterThanOrEqual(0);
      expect(res.ai_share, `case ${i}`).toBeLessThanOrEqual(BRIEF_CAP);
      if (mode === "all") expect(res.ai_share, `all-LLM case ${i}`).toBe(0);
      if (mode === "all") expect(res.score, `all-LLM case ${i}`).toBe(0);
      if (mode === "none") expect(res.ai_share).toBe(0);
      if (res.ai_share > 0) positive++;
      expect(res.llm_signal_ids.sort()).toEqual(res.axes.flatMap((a) => a.signals.filter((s) => s.llm_used).map((s) => s.id)).sort());
    }
    // The generator must actually exercise the guard, or the bound is vacuous.
    expect(positive).toBeGreaterThan(100);
  });

  it("empty and non-LLM-only sets ⇒ ai_share 0", () => {
    expect(score({ signals: [], words_scanned: 0, step_status: ALL_DONE, archived_snapshots: 0 }).ai_share).toBe(0);
    const s = [signal({ axis: "track", kind: "claim.removed" })];
    expect(score({ signals: s, words_scanned: 0, step_status: ALL_DONE, archived_snapshots: 0 }).ai_share).toBe(0);
  });

  it("hand case: LLM points would be 90% of the score ⇒ the guard scales them to exactly 50%", () => {
    // Track axis only: one rule-based removal (20 points) and LLM removals worth 180 points ⇒ 10% / 90%
    // before the cap. Caps are set high enough here not to interfere.
    const w = structuredClone(WEIGHTS);
    w.caps.track = 100;
    const rule = signal({ axis: "track", kind: "claim.removed", weight_hint: 0.1 }); // 2 points
    const llm = signal({ axis: "track", kind: "claim.removed", weight_hint: 0.9, llm_used: true }); // 18 points
    const res = score({ signals: [rule, llm], words_scanned: 0, step_status: ALL_DONE, archived_snapshots: 0 }, { weights: w });
    const nonLlm = 2 * WEIGHTS.axes.track;
    const before = 20 * WEIGHTS.axes.track;
    expect((before - nonLlm) / before).toBeCloseTo(0.9, 12);
    expect(res.ai_share).toBe(BRIEF_CAP);
    expect(res.llm_signal_ids).toEqual([llm.id]);
    expect(res.score).toBe(Math.round(2 * nonLlm));

    const g = applyLlmGuard([{ weight: 1, total: 100, nonLlm: 10 }], WEIGHTS.llmGuard.maxShare);
    expect(g).toEqual({ score: 20, nonLlmPoints: 10, llmPoints: 10, aiShare: 0.5, scaled: true });
  });

  it("below the cap the guard changes nothing", () => {
    const g = applyLlmGuard([{ weight: 0.5, total: 60, nonLlm: 40 }, { weight: 0.5, total: 20, nonLlm: 20 }], WEIGHTS.llmGuard.maxShare);
    expect(g.scaled).toBe(false);
    expect(g.score).toBeCloseTo(40, 12);
    expect(g.aiShare).toBeCloseTo(10 / 40, 12);
  });

  it("LLM signals never take points from a rule-based signal on a capped axis", () => {
    const rule = signal({ axis: "repair", kind: "repair.no_repair_info_found", weight_hint: 2 }); // 100, capped
    const llm = signal({ axis: "repair", kind: "repair.no_repair_info_found", llm_used: true });
    const res = score({ signals: [rule, llm], words_scanned: 0, step_status: ALL_DONE, archived_snapshots: 0 });
    expect(res.ai_share).toBe(0);
    expect(res.score).toBe(Math.round(100 * WEIGHTS.axes.repair));
  });
});
