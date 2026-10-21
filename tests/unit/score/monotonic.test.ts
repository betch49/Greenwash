import { describe, expect, it } from "vitest";
import { score } from "@/lib/score/scorer";
import { randomInput, rng } from "./random";

describe("missing data never increases the score (6.2)", () => {
  it("removing any one signal from 500 random signal sets never raises the score", () => {
    const r = rng(20261021);
    let checked = 0;
    for (let set = 0; set < 500; set++) {
      const input = randomInput(r, set % 3 === 0 ? "all" : set % 3 === 1 ? "none" : "mixed");
      const full = score(input).score;
      for (let i = 0; i < input.signals.length; i++) {
        const without = score({ ...input, signals: input.signals.filter((_, j) => j !== i) }).score;
        expect(without, `set ${set}, signal ${i} (${input.signals[i].axis}/${input.signals[i].kind}, llm ${input.signals[i].llm_used})`).toBeLessThanOrEqual(full);
        checked++;
      }
      // Removing everything is the extreme case of missing data.
      expect(score({ ...input, signals: [] }).score).toBeLessThanOrEqual(full);
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it("removing a random subset never raises the score either", () => {
    const r = rng(7);
    for (let set = 0; set < 500; set++) {
      const input = randomInput(r);
      const full = score(input).score;
      const subset = input.signals.filter(() => r() < 0.5);
      expect(score({ ...input, signals: subset }).score).toBeLessThanOrEqual(full);
    }
  });
});
