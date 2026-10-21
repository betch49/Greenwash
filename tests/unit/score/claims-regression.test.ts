// Criterion 14.3: the two fictional regression brands (fixtures/score/claims-regression.json).
// v1 ranks silent < talkative ("saying less scores better"); v2 must rank talkative ≤ silent
// or mark silent `insufficient_data`. The v1 ordering is documented here too.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { score, type ClaimCounts } from "@/lib/score/scorer";
import { WEIGHTS, WeightsSchema, type Weights } from "@/lib/score/weights";
import { ALL_DONE, signal } from "./random";

interface Fixture {
  brands: { slug: string; name: string; website: string; words_scanned: number; claim_stats: ClaimCounts }[];
}
const FIX = JSON.parse(readFileSync("fixtures/score/claims-regression.json", "utf8")) as Fixture;
const withVersion = (version: 1 | 2): Weights => WeightsSchema.parse({ ...WEIGHTS, claimsRate: { ...WEIGHTS.claimsRate, version } });
const V1 = withVersion(1);
const V2 = withVersion(2);

const brand = (slug: string) => {
  const b = FIX.brands.find((x) => x.slug === slug);
  if (!b) throw new Error(`no fixture brand ${slug}`);
  return b;
};
const run = (slug: string, w: Weights) => {
  const b = brand(slug);
  // One receipted signal per claim sentence, as the claims step emits them (ClaimStats carries the counts).
  const signals = Array.from({ length: b.claim_stats.matches }, (_, i) => signal({ axis: "claims", kind: i < b.claim_stats.unsupported ? "claim.unsupported" : "claim.supported", source_url: b.website }));
  const r = score({ signals, words_scanned: b.words_scanned, step_status: ALL_DONE, archived_snapshots: 0, claim_stats: b.claim_stats }, { weights: w });
  return { ...r, claims: r.axes.find((a) => a.id === "claims")! };
};

describe("regression fixtures (14.3)", () => {
  it("the fixture is what the plan describes: silent 0/1,500 words; talkative 20 claims, 18 supported; both fictional .example", () => {
    const silent = brand("silent.example");
    const talkative = brand("talkative.example");
    expect(silent.claim_stats).toEqual({ matches: 0, unsupported: 0, wordCount: 1500 });
    expect(talkative.claim_stats.matches).toBe(20);
    expect(talkative.claim_stats.matches - talkative.claim_stats.unsupported).toBe(18);
    for (const b of FIX.brands) expect(new URL(b.website).hostname).toMatch(/\.example$/);
  });

  it("v1 (density): silent < talkative — the substantiated brand scores higher than the silent one", () => {
    const silent = run("silent.example", V1);
    const talkative = run("talkative.example", V1);
    expect(silent.claims.subscore).toBe(0);
    // (2 × 1 + 18 × 0.25) points per 1,500 words × 1000 × 15 = 65
    expect(talkative.claims.subscore).toBe(65);
    expect(silent.claims.subscore).toBeLessThan(talkative.claims.subscore);
    expect(silent.score).toBeLessThan(talkative.score);
  });

  it("v2 (share): silent is `insufficient_data` (0, lower confidence); talkative is scored at (2 + 0.25×18)/20 = 32.5", () => {
    const silent = run("silent.example", V2);
    const talkative = run("talkative.example", V2);
    expect(silent.claims.status).toBe("insufficient_data");
    expect(silent.claims.subscore).toBe(0);
    expect(talkative.claims.status).toBe("scored");
    expect(talkative.claims.subscore).toBe(Math.round(32.5));
    expect(silent.confidence).toBeLessThan(talkative.confidence);
    // The deliverable's condition: talkative ≤ silent, or silent marked insufficient_data. Here it is the latter;
    // the talkative brand's claims sub-score is also lower than under v1 (32.5 vs 65).
    expect(talkative.claims.subscore).toBeLessThan(run("talkative.example", V1).claims.subscore);
  });
});
