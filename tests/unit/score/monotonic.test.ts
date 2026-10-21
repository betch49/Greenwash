import { describe, expect, it } from "vitest";
import { claimShareCounts, score } from "@/lib/score/scorer";
import { WEIGHTS, WeightsSchema, type Weights } from "@/lib/score/weights";
import { ALL_DONE, randomInput, rng, signal } from "./random";

const withVersion = (version: 1 | 2): Weights => WeightsSchema.parse({ ...WEIGHTS, claimsRate: { ...WEIGHTS.claimsRate, version } });
const VERSIONS: { version: 1 | 2; weights: Weights }[] = [
  { version: 1, weights: withVersion(1) },
  { version: 2, weights: withVersion(2) },
];

// Phase 14 (criterion 14.2): the property is run per claims-formula version. Every
// re-score below recomputes `m` from the remaining signals (the scorer counts the
// claim sentences of the input it is given; nothing is cached), so a removed signal
// changes `u`, `s` and `m` together, exactly as the plan requires.
//
// Why the v2 property holds for an unsupported removal and for the clamp:
//   removing one unsupported hit: (u − 1)/(m − 1) ≤ u/m whenever u ≤ m (always), or
//   m falls below minClaims and the axis contributes 0 (the implemented clamp);
// and why it does NOT hold in general for a supported removal:
//   new share (u + w(s − 1))/(m − 1) ≤ old share (u + ws)/m  ⇔  (u + ws)/m ≤ w,
//   i.e. only when the share is already at its floor w. In every other case a
//   supported sentence is protective in a share, so losing it raises the share.
//   The plan ("the builder reports it … and keeps v1 as default") is followed: the
//   counter-example is pinned below, the full v2 property is marked `it.fails`,
//   and config/weights.json ships with version 1.
describe("missing data never increases the score (6.2)", () => {
  describe.each(VERSIONS)("claims formula v$version", ({ version, weights }) => {
    const opts = { weights };
    // Under v1 every signal; under v2 every signal except a supported claim sentence (see the note above).
    const removable = (s: { axis: string; kind: string }) => version === 1 || !(s.axis === "claims" && s.kind === "claim.supported");

    it("removing any one signal from 500 random signal sets never raises the score", () => {
      const r = rng(20261021);
      let checked = 0;
      for (let set = 0; set < 500; set++) {
        const input = randomInput(r, set % 3 === 0 ? "all" : set % 3 === 1 ? "none" : "mixed");
        const full = score(input, opts).score;
        for (let i = 0; i < input.signals.length; i++) {
          if (!removable(input.signals[i])) continue;
          const without = score({ ...input, signals: input.signals.filter((_, j) => j !== i) }, opts).score;
          expect(without, `v${version} set ${set}, signal ${i} (${input.signals[i].axis}/${input.signals[i].kind}, llm ${input.signals[i].llm_used})`).toBeLessThanOrEqual(full);
          checked++;
        }
        // Removing everything is the extreme case of missing data.
        expect(score({ ...input, signals: [] }, opts).score).toBeLessThanOrEqual(full);
      }
      expect(checked).toBeGreaterThan(5000);
    });

    it("removing a random subset never raises the score either", () => {
      const r = rng(7);
      for (let set = 0; set < 500; set++) {
        const input = randomInput(r);
        const full = score(input, opts).score;
        const subset = input.signals.filter((s) => !removable(s) || r() < 0.5);
        expect(score({ ...input, signals: subset }, opts).score).toBeLessThanOrEqual(full);
      }
    });
  });

  describe("v2 over 1,000 random signal sets, with m recomputed from the remaining signals (14.2)", () => {
    const weights = withVersion(2);
    const opts = { weights };

    it("the clamp: when m drops below minClaims the claims axis contributes 0 and is insufficient_data", () => {
      const r = rng(14);
      let clamped = 0;
      for (let set = 0; set < 1000; set++) {
        const input = randomInput(r, "none");
        for (let i = 0; i < input.signals.length; i++) {
          const rest = input.signals.filter((_, j) => j !== i);
          const m = claimShareCounts(rest, input.claim_stats).m;
          if (m >= weights.claimsRate.v2.minClaims) continue;
          const axis = score({ ...input, signals: rest }, opts).axes.find((a) => a.id === "claims")!;
          expect(axis.subscore).toBe(0);
          if (input.step_status.claims === "done" && input.repair_axis !== "not_applicable") expect(axis.status).toBe("insufficient_data");
          clamped++;
        }
      }
      expect(clamped).toBeGreaterThan(100);
    });

    it("removing an unsupported claim sentence (rule or LLM) never raises the score", () => {
      const r = rng(2026);
      let checked = 0;
      for (let set = 0; set < 1000; set++) {
        const input = randomInput(r);
        const full = score(input, opts).score;
        for (let i = 0; i < input.signals.length; i++) {
          if (input.signals[i].axis === "claims" && input.signals[i].kind === "claim.supported") continue;
          const without = score({ ...input, signals: input.signals.filter((_, j) => j !== i) }, opts).score;
          expect(without, `set ${set}, signal ${i}`).toBeLessThanOrEqual(full);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(10000);
    });

    // Reported in docs/phases/14.md: the full property does not hold for v2 (a supported sentence is
    // protective in a share). This test is expected to fail; Vitest fails the suite if it ever passes,
    // so the counter-example cannot silently disappear.
    it.fails("the full 6.2 property over 1,000 random sets (fails: a removed supported claim raises the share)", () => {
      const r = rng(20261021);
      for (let set = 0; set < 1000; set++) {
        const input = randomInput(r, set % 3 === 0 ? "all" : set % 3 === 1 ? "none" : "mixed");
        const full = score(input, opts).score;
        for (let i = 0; i < input.signals.length; i++) {
          const without = score({ ...input, signals: input.signals.filter((_, j) => j !== i) }, opts).score;
          expect(without).toBeLessThanOrEqual(full);
        }
      }
    });

    it("counter-example (pinned): u=5, s=1, m=6 ⇒ 87.5; without the supported sentence u=5, m=5 ⇒ 100", () => {
      const unsupported = Array.from({ length: 5 }, () => signal({ axis: "claims", kind: "claim.unsupported" }));
      const supported = signal({ axis: "claims", kind: "claim.supported" });
      const base = { words_scanned: 2000, step_status: ALL_DONE, archived_snapshots: 0 };
      const withS = score({ ...base, signals: [...unsupported, supported] }, opts);
      const withoutS = score({ ...base, signals: unsupported }, opts);
      expect(withS.axes.find((a) => a.id === "claims")!.subscore).toBe(Math.round(87.5));
      expect(withoutS.axes.find((a) => a.id === "claims")!.subscore).toBe(100);
      expect(withoutS.score).toBeGreaterThan(withS.score);
      // Under v1 the same removal lowers the score, as the brief requires.
      const v1 = { weights: withVersion(1) };
      expect(score({ ...base, signals: unsupported }, v1).score).toBeLessThanOrEqual(score({ ...base, signals: [...unsupported, supported] }, v1).score);
    });
  });
});
