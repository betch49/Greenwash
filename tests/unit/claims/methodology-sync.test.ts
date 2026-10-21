import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classify } from "@/lib/claims/engine";
import { EVIDENCE_RULE_IDS } from "@/lib/claims/evidence-rules";
import { RULE_IDS } from "@/lib/claims/rules";

const DOC = readFileSync("docs/METHODOLOGY.md", "utf8");

/** Sections headed "### `rule_id` …" with "- hit: “…”" / "- miss: “…”" example lines. */
function examples(): Map<string, { hit: string[]; miss: string[] }> {
  const out = new Map<string, { hit: string[]; miss: string[] }>();
  const parts = DOC.split(/^### `([a-z_]+)`.*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const ex = { hit: [] as string[], miss: [] as string[] };
    for (const m of parts[i + 1].matchAll(/^- (hit|miss): “(.+)”\s*$/gm)) ex[m[1] as "hit" | "miss"].push(m[2]);
    out.set(parts[i], ex);
  }
  return out;
}

describe("docs/METHODOLOGY.md stays in sync with the rule registry (3.7)", () => {
  it("lists every claim rule id and every evidence rule id exported by the engine", () => {
    for (const id of [...RULE_IDS, ...EVIDENCE_RULE_IDS]) expect(DOC, id).toContain(`\`${id}\``);
  });

  it("has a section per claim rule with two hits and one miss, and the examples classify as documented", () => {
    const ex = examples();
    for (const id of RULE_IDS) {
      const e = ex.get(id);
      expect(e, `section for ${id}`).toBeDefined();
      expect(e!.hit.length, `${id} hits`).toBeGreaterThanOrEqual(2);
      expect(e!.miss.length, `${id} misses`).toBeGreaterThanOrEqual(1);
      for (const s of e!.hit) expect(classify(s).map((m) => m.ruleId), s).toContain(id);
      for (const s of e!.miss) expect(classify(s).map((m) => m.ruleId), s).not.toContain(id);
    }
  });

  it("names no rule id that the engine does not have", () => {
    const known = new Set<string>([...RULE_IDS, ...EVIDENCE_RULE_IDS]);
    for (const id of examples().keys()) expect(known.has(id), id).toBe(true);
  });
});
