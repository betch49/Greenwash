// Criterion 10.4 (ADR-025): ground-truth labels never reach the score.
// - No file under src/ outside src/lib/validation/ imports src/lib/validation or reads fixtures/validation.
// - src/lib/validation/** is imported only by scripts/validate.ts and tests/** (and by itself).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const VALIDATION = join(ROOT, "src", "lib", "validation");
const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : CODE.test(name) ? [p] : [];
  });
}

/** Every module specifier in a file: static imports, re-exports, dynamic import() and require(). */
export function specifiers(source: string): string[] {
  const out: string[] = [];
  const res = [/\b(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g, /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g];
  for (const re of res) for (const m of source.matchAll(re)) out.push(m[1]);
  return out;
}

/** Resolves a specifier to an absolute path prefix ("@/…" is src/…); bare packages ⇒ null. */
export function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@/")) return join(ROOT, "src", spec.slice(2));
  if (spec.startsWith(".")) return resolve(dirname(fromFile), spec);
  return null;
}

const importsValidation = (file: string, source: string) =>
  specifiers(source).some((s) => {
    const r = resolveSpecifier(file, s);
    return r !== null && (r === VALIDATION || r.startsWith(VALIDATION + "/"));
  });

/** A file that names the ground-truth location in any form (path string, file name). */
const readsGroundTruth = (source: string) => /fixtures[/\\'"\s,+]+validation|ground-truth\.json|GROUND_TRUTH_PATH/.test(source);

describe("ground-truth isolation (10.4)", () => {
  const srcFiles = walk(join(ROOT, "src"));
  const outsideValidation = srcFiles.filter((f) => !f.startsWith(VALIDATION + "/"));

  it("scans the app (sanity: pipeline, score, regulators, repair and app files are included)", () => {
    const rel = outsideValidation.map((f) => relative(ROOT, f));
    for (const dir of ["src/lib/pipeline/", "src/lib/score/", "src/lib/regulators/", "src/lib/repair/", "src/app/"]) expect(rel.some((r) => r.startsWith(dir)), dir).toBe(true);
  });

  it("no file under src/ outside src/lib/validation imports it", () => {
    const offenders = outsideValidation.filter((f) => importsValidation(f, readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("no file under src/ outside src/lib/validation reads fixtures/validation", () => {
    const offenders = outsideValidation.filter((f) => readsGroundTruth(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("src/lib/validation is imported only by scripts/validate.ts and tests/**", () => {
    const all = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "scripts")), ...walk(join(ROOT, "tests"))].filter((f) => !f.startsWith(VALIDATION + "/"));
    const importers = all.filter((f) => importsValidation(f, readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(importers.length).toBeGreaterThan(0);
    for (const f of importers) expect(f === "scripts/validate.ts" || f.startsWith("tests/"), f).toBe(true);
  });

  it("the scanner itself catches the import forms it must catch", () => {
    const f = join(ROOT, "src", "lib", "score", "x.ts");
    expect(importsValidation(f, `import { auc } from "../validation/stats";`)).toBe(true);
    expect(importsValidation(f, `import type { Entry } from "@/lib/validation/ground-truth";`)).toBe(true);
    expect(importsValidation(f, `export * from "../validation";`)).toBe(true);
    expect(importsValidation(f, `const m = await import("../validation/harness");`)).toBe(true);
    expect(importsValidation(f, `const m = require("../validation/report");`)).toBe(true);
    expect(importsValidation(f, `import "../validation/ground-truth";`)).toBe(true);
    expect(importsValidation(f, `import { x } from "../validationish";`)).toBe(false);
    expect(readsGroundTruth(`readFileSync(join("fixtures", "validation", "ground-truth.json"))`)).toBe(true);
    expect(readsGroundTruth(`readFileSync("fixtures/validation/ground-truth.json")`)).toBe(true);
  });
});
