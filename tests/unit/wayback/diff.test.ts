import { describe, expect, it } from "vitest";
import { diffSentences, diffSnapshots, normaliseSentence, similarity } from "@/lib/wayback/diff";

describe("sentence diff", () => {
  it("returns removed and added sentences with the two timestamps", () => {
    const d = diffSnapshots({ text: "A one. B two.\nC three.", timestamp: "20210101000000" }, { text: "A one.\nC three. D four.", timestamp: "20240101000000" });
    expect(d).toEqual({ removed: ["B two."], added: ["D four."], from: "20210101000000", to: "20240101000000" });
  });

  it("case, spacing and closing punctuation do not make a sentence different", () => {
    expect(diffSentences(["We are carbon neutral."], ["we are  carbon neutral"], "a", "b")).toEqual({ removed: [], added: [], from: "a", to: "b" });
    expect(normaliseSentence("  Our “gear”  lasts!  ")).toBe('our "gear" lasts');
  });

  it("similarity: 1 for equal text, high for rewording, low for a different sentence", () => {
    expect(similarity("We are carbon neutral.", "we are carbon neutral")).toBe(1);
    expect(similarity("We're committed to regenerative farming.", "We are committed to regenerative farming.")).toBeGreaterThanOrEqual(0.8);
    expect(similarity("Every jacket is climate neutral.", "We publish our methodology.")).toBeLessThan(0.3);
    expect(similarity("", "")).toBe(1);
    expect(similarity("a", "b")).toBe(0);
  });
});
