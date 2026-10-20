import { describe, expect, it } from "vitest";
import { classify } from "@/lib/claims/engine";
import { CLAIM_RULES, RULE_IDS } from "@/lib/claims/rules";
import { SENTENCES } from "./sentences";

describe("claim rules: 20 documented sentences (3.1)", () => {
  it("has four sentences per family, five families", () => {
    expect(SENTENCES).toHaveLength(20);
    const families = new Set(CLAIM_RULES.map((r) => r.family));
    expect(families.size).toBe(5);
    for (const f of families) expect(SENTENCES.filter((s) => s.family === f)).toHaveLength(4);
  });

  it.each(SENTENCES.map((s) => [s.expected ?? "null", s.sentence, s]))("%s ⇐ %s", (_id, _s, c) => {
    const ids = classify(c.sentence, c.next).map((m) => m.ruleId);
    expect(ids).toEqual(c.expected ? [c.expected] : []);
  });
});

describe("rule registry", () => {
  it("one rule per family, unique ids, each with a description", () => {
    expect(new Set(RULE_IDS).size).toBe(RULE_IDS.length);
    for (const r of CLAIM_RULES) {
      expect(r.description.length).toBeGreaterThan(20);
      expect(r.test("Nothing to see here.")).toBeNull();
    }
  });

  it("word boundaries: 'green' is not found in 'evergreen', 'cleaner' alone is not a claim", () => {
    expect(classify("Our evergreen product range ships worldwide.")).toEqual([]);
    expect(classify("The Fairbuds feature drivers for better, cleaner, richer sound.")).toEqual([]);
  });

  it("questions assert nothing", () => {
    expect(classify("How sustainable is the Fairphone 3?")).toEqual([]);
    expect(classify("So what does e-waste neutral mean?")).toEqual([]);
  });

  it("a neutrality target is future-only, not offset", () => {
    expect(classify("We will be carbon neutral by 2030.").map((m) => m.ruleId)).toEqual(["future_only"]);
  });

  it("future-only needs an environmental topic", () => {
    expect(classify("We will email you a receipt.")).toEqual([]);
  });

  it("the next sentence's reduction figure clears an offset claim", () => {
    expect(classify("We are carbon neutral.", "We reduced our emissions by 41% since 2019.")).toEqual([]);
  });

  it("one sentence can match two families", () => {
    const ids = classify("Our jackets are made with eco-friendly materials and are better for the planet.").map((m) => m.ruleId);
    expect(ids).toEqual(["vague", "baseline_less_comparison"]);
  });
});
