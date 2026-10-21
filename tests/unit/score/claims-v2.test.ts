// Criterion 14.1: claims formula v2 (ADR-030) on hand cases, behind claimsRate.version.
import { describe, expect, it } from "vitest";
import { couldNotCheck, scoreWording } from "@/lib/copy/wording";
import { buildReport } from "@/lib/score/report";
import { claimShareCounts, claimsShareSubscore, score, supportedWeight } from "@/lib/score/scorer";
import { WEIGHTS, WeightsSchema, type Weights } from "@/lib/score/weights";
import raw from "../../../config/weights.json";
import { ALL_DONE, signal } from "./random";

export const withVersion = (version: 1 | 2, base: Weights = WEIGHTS): Weights => WeightsSchema.parse({ ...base, claimsRate: { ...base.claimsRate, version } });
const V2 = withVersion(2);
const V1 = withVersion(1);
// With ClaimStats present the rule-based claim signals are the receipts of the same hits (not double counted):
// one is enough for the axis to count as having data, as in a real run where every hit emits a signal.
const base = { signals: [signal({ axis: "claims", kind: "claim.unsupported" })], words_scanned: 5000, step_status: ALL_DONE, archived_snapshots: 0 };
const stats = (matches: number, unsupported: number) => ({ matches, unsupported, wordCount: 5000 });
const claims = (r: ReturnType<typeof score>) => r.axes.find((a) => a.id === "claims")!;

describe("config (14.4): the version and minClaims live only in config/weights.json", () => {
  it("ships with version 1 (the director flips it, ADR-032) and the director's minClaims of 5", () => {
    expect(raw.claimsRate.version).toBe(1);
    expect(WEIGHTS.claimsRate.version).toBe(1);
    expect(raw.claimsRate.v2.minClaims).toBe(5);
    expect(raw.claimsRate.v2.insufficientDataStatus).toBe("insufficient_data");
  });

  it("supportedWeight is read from the points (0.25), never duplicated", () => {
    expect(supportedWeight()).toBe(WEIGHTS.points.claims["claim.supported"] / WEIGHTS.points.claims["claim.unsupported"]);
    expect(supportedWeight()).toBe(0.25);
    expect("supportedWeight" in raw.claimsRate.v2).toBe(false);
  });

  it("the schema rejects any other version", () => {
    expect(() => WeightsSchema.parse({ ...raw, claimsRate: { ...raw.claimsRate, version: 3 } })).toThrow();
  });
});

describe("formula v2 hand cases (14.1)", () => {
  it("m=10, u=6, s=4 ⇒ (6 + 0.25×4)/10 × 100 = 70", () => {
    expect(claimsShareSubscore({ m: 10, u: 6, s: 4 }, V2)).toEqual({ subscore: 70, insufficient: false });
    const r = score({ ...base, claim_stats: stats(10, 6) }, { weights: V2 });
    expect(claims(r).subscore).toBe(70);
    expect(claims(r).status).toBe("scored");
  });

  it("m=20, u=0, s=20 ⇒ 25", () => {
    expect(claimsShareSubscore({ m: 20, u: 0, s: 20 }, V2).subscore).toBe(25);
    expect(claims(score({ ...base, claim_stats: stats(20, 0) }, { weights: V2 })).subscore).toBe(25);
  });

  it("m=4 ⇒ insufficient_data, 0 contribution, confidence lower than with m=5", () => {
    const four = score({ ...base, claim_stats: stats(4, 4) }, { weights: V2 });
    const five = score({ ...base, claim_stats: stats(5, 5) }, { weights: V2 });
    expect(claims(four).status).toBe("insufficient_data");
    expect(claims(four).subscore).toBe(0);
    expect(four.score).toBe(0);
    expect(claims(five).status).toBe("scored");
    expect(claims(five).subscore).toBe(100);
    expect(four.confidence).toBeLessThan(five.confidence);
    // The axis weight is exactly what confidence loses (like a skipped step).
    expect(five.confidence - four.confidence).toBe(Math.round(WEIGHTS.axes.claims * 100));
  });

  it("v1 scores the same m=4 input as a rate (the behaviour under test is only switched by the version)", () => {
    const r = score({ ...base, claim_stats: stats(4, 4) }, { weights: V1 });
    expect(claims(r).status).toBe("scored");
    expect(claims(r).subscore).toBe(Math.round((4 * 1000) / 5000 * WEIGHTS.claimsRate.subscorePerPointPer1000Words));
  });

  it("the sub-score is capped at the axis cap and never below 0", () => {
    expect(claimsShareSubscore({ m: 5, u: 5, s: 0 }, V2).subscore).toBe(Math.min(100, V2.caps.claims));
    expect(claimsShareSubscore({ m: 5, u: 0, s: 0 }, V2).subscore).toBe(0);
  });

  it("insufficient data needs the claims step to have run: a skipped step stays `missing`", () => {
    const r = score({ ...base, step_status: { ...ALL_DONE, claims: "skipped" }, claim_stats: stats(2, 2) }, { weights: V2 });
    expect(claims(r).status).toBe("missing");
  });
});

describe("counting m (ClaimStats + LLM-only claim signals)", () => {
  it("ClaimStats is the rule-based part; LLM claim signals add on top; rule signals are not double counted", () => {
    const signals = [
      signal({ axis: "claims", kind: "claim.unsupported", llm_used: false }),
      signal({ axis: "claims", kind: "claim.unsupported", llm_used: true }),
      signal({ axis: "claims", kind: "claim.supported", llm_used: true }),
      signal({ axis: "claims", kind: "unknown.kind", llm_used: true }),
    ];
    expect(claimShareCounts(signals, stats(10, 6))).toEqual({ m: 12, u: 7, s: 5 });
    expect(claimShareCounts(signals, stats(10, 6), false)).toEqual({ m: 10, u: 6, s: 4 });
  });

  it("without ClaimStats every rule-based claim signal counts once", () => {
    const signals = [signal({ axis: "claims", kind: "claim.unsupported" }), signal({ axis: "claims", kind: "claim.supported" }), signal({ axis: "claims", kind: "claim.supported" })];
    expect(claimShareCounts(signals, undefined)).toEqual({ m: 3, u: 1, s: 2 });
  });

  it("unsupported never exceeds matches (defensive clamp)", () => {
    expect(claimShareCounts([], stats(3, 9))).toEqual({ m: 3, u: 3, s: 0 });
  });

  it("LLM claim signals stay under the 50% guard under v2", () => {
    const signals = Array.from({ length: 10 }, () => signal({ axis: "claims", kind: "claim.unsupported", llm_used: true }));
    const r = score({ ...base, signals, claim_stats: stats(5, 1) }, { weights: V2 });
    expect(r.ai_share).toBeLessThanOrEqual(WEIGHTS.llmGuard.maxShare);
    expect(r.ai_share).toBeGreaterThan(0);
  });
});

describe("report wiring", () => {
  const outcome = {
    signals: [],
    pages: [{ wordCount: 1500 }] as never,
    repair_axis: "applicable" as const,
    step_status: ALL_DONE,
    timeline: [],
    could_not_check: ["Existing line."],
    progress: [],
    claim_stats: stats(0, 0) as never,
  };
  const run = { id: "r1", brand: "Silent", website: "https://silent.example/" };

  it("an insufficient-data claims axis adds the could-not-check line and a rendered status label", () => {
    const report = buildReport(run, outcome, new Date("2026-10-21T12:00:00Z"), { weights: V2 });
    expect(report.axes.find((a) => a.id === "claims")?.status).toBe("insufficient_data");
    expect(report.could_not_check).toEqual(["Existing line.", couldNotCheck.claimsInsufficient(5)]);
    expect(couldNotCheck.claimsInsufficient(5)).toMatch(/^Fewer than 5 environmental claim sentences were found on the fetched pages; the claim-language axis was not scored\.$/);
    expect(scoreWording.axisStatus.insufficient_data).toContain("lowers confidence");
  });

  it("under v1 the same run adds no line", () => {
    const report = buildReport(run, outcome, new Date("2026-10-21T12:00:00Z"), { weights: V1 });
    expect(report.could_not_check).toEqual(["Existing line."]);
  });
});
