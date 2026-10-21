import { describe, expect, it } from "vitest";
import { splitSentences } from "@/lib/claims/split";

describe("sentence splitter", () => {
  it("splits on . ! ? followed by a capital, keeps lines apart", () => {
    expect(splitSentences("We are green. We are clean!\nHeading\nIs it? Yes.")).toEqual([
      "We are green.",
      "We are clean!",
      "Heading",
      "Is it?",
      "Yes.",
    ]);
  });

  it("does not split after abbreviations, initials, decimals or before lowercase", () => {
    expect(splitSentences("Patagonia Inc. is based in the U.S. and e.g. sells gear. J. Smith said 2.5 t. it is fine… and more.")).toEqual([
      "Patagonia Inc. is based in the U.S. and e.g. sells gear.",
      "J. Smith said 2.5 t. it is fine… and more.",
    ]);
  });

  it("splits after a unit such as L/L. before a capital", () => {
    expect(splitSentences("An increase from 2.8 L/L. Our goal is 2.2 L/L.")).toEqual(["An increase from 2.8 L/L.", "Our goal is 2.2 L/L."]);
  });

  it("is deterministic and drops empty lines", () => {
    const t = "A claim.  \n\n  Another one.   Third?";
    expect(splitSentences(t)).toEqual(splitSentences(t));
    expect(splitSentences(t)).toEqual(["A claim.", "Another one.", "Third?"]);
  });
});
