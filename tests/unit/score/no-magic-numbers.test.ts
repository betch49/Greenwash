import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// PLAN 6.5: scorer.ts and ai-share.ts (and confidence.ts) hold no numeric literal other than 0, 1, 100.
const FILES = ["src/lib/score/scorer.ts", "src/lib/score/ai-share.ts", "src/lib/score/confidence.ts"];
const ALLOWED = new Set([0, 1, 100]);

function numericLiterals(file: string): { text: string; value: number }[] {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const out: { text: string; value: number }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) out.push({ text: node.getText(), value: Number(node.text.replace(/n$/, "")) });
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out;
}

describe("no magic numbers in the scorer (6.5)", () => {
  for (const f of FILES) {
    it(`${f} contains only 0, 1 and 100 as numeric literals`, () => {
      const bad = numericLiterals(f).filter((n) => !ALLOWED.has(n.value));
      expect(bad).toEqual([]);
    });
  }

  it("the scan sees literals (so an empty scan cannot pass silently)", () => {
    expect(numericLiterals("src/lib/score/confidence.ts").map((n) => n.value)).toContain(100);
    const probe = "/tmp-probe.ts";
    const src = ts.createSourceFile(probe, "const x = 0.25 + 3;", ts.ScriptTarget.Latest, true);
    const found: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isNumericLiteral(n)) found.push(n.text);
      ts.forEachChild(n, visit);
    };
    visit(src);
    expect(found).toEqual(["0.25", "3"]);
  });

  it("no score file or score-relevant module defines points or weights outside config/weights.json", () => {
    for (const f of ["src/lib/claims/engine.ts", "src/lib/repair/brand-pages.ts", "src/lib/repair/ifixit.ts"]) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/WEIGHT_HINT\s*=\s*\d/);
    }
  });
});
