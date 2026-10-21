import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { findForbidden, passesWordingFilter } from "@/lib/copy/forbidden";

const ROOT = process.cwd();
/** The list itself is the only file allowed to spell the words out. */
const EXEMPT = new Set(["src/lib/copy/forbidden.ts"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/** Every string a source file could show: string literals, template parts and JSX text. Comments are not strings. */
function stringLiterals(file: string): string[] {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text);
    else if (ts.isJsxText(node)) out.push(node.getText());
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out;
}

describe("forbidden words (3.6, ADR-008)", () => {
  it("appear in no string literal under src/**/*.{ts,tsx}", () => {
    const sources = files(join(ROOT, "src")).filter((f) => !EXEMPT.has(relative(ROOT, f)));
    expect(sources.length).toBeGreaterThan(20);
    const hits = sources.flatMap((f) =>
      stringLiterals(f).flatMap((s) => findForbidden(s).map((h) => `${relative(ROOT, f)}: "${h.term}" in …${h.context}…`)),
    );
    expect(hits).toEqual([]);
  });

  it("appear nowhere in docs/METHODOLOGY.md", () => {
    const hits = findForbidden(readFileSync(join(ROOT, "docs/METHODOLOGY.md"), "utf8")).map((h) => `"${h.term}" in …${h.context}…`);
    expect(hits).toEqual([]);
  });

  it("the scanner sees literals in .ts and .tsx (so an empty scan cannot pass silently)", () => {
    expect(stringLiterals(join(ROOT, "src/lib/copy/wording.ts")).some((s) => s.includes("Greenwash Radar"))).toBe(true);
    expect(stringLiterals(join(ROOT, "src/app/page.tsx")).length).toBeGreaterThan(0);
  });

  it("the filter: each listed word is caught; the product name and 'greenwashing risk …' are allowed", () => {
    for (const bad of [
      "This brand lies about its footprint.",
      "They are lying.",
      "Found guilty of it.",
      "An illegal claim.",
      "The page is non-compliant.",
      "This is fraud.",
      "A fraudulent label.",
      "A deceptive claim.",
      "Acme is greenwashing.",
      "Their greenwashing is obvious.",
      "Acme greenwashed its packaging.",
    ]) {
      expect(passesWordingFilter(bad), bad).toBe(false);
    }
    for (const ok of [
      "Greenwash Radar",
      "GreenwashRadar/0.1",
      "data/greenwash.db",
      "Evidence-backed greenwashing risk signals.",
      "A greenwashing risk score of 41.",
      "Unsupported claim: no supporting data found on the fetched page.",
      "Supplies and supplier lists.",
      "Our compliant-looking page.",
    ]) {
      expect(findForbidden(ok), ok).toEqual([]);
    }
  });
});
