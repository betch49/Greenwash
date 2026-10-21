import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { weightsMarkdown } from "@/lib/score/methodology";
import { AXES } from "@/lib/score/weights";
import raw from "../../../config/weights.json";

const DOC = readFileSync("docs/METHODOLOGY.md", "utf8");

function section7(): string {
  const m = /^## 7\. Weights\n\n([\s\S]*?)\n+(?=^## )/m.exec(DOC);
  if (!m) throw new Error("docs/METHODOLOGY.md has no Section 7");
  return m[1];
}

function table(body: string, heading: string): string[][] {
  const part = (body.split(`### ${heading}\n`)[1] ?? "").split("\n### ")[0];
  return part
    .split("\n")
    .filter((l) => l.startsWith("|") && !l.startsWith("|---"))
    .slice(1)
    .map((l) =>
      l
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim().replace(/`/g, "")),
    );
}

describe("docs/METHODOLOGY.md weights section equals config/weights.json (6.8)", () => {
  it("Section 7 is exactly what weightsMarkdown() generates from the file", () => {
    expect(section7()).toBe(weightsMarkdown());
  });

  it("parsed axis table = axes and caps of the file", () => {
    const rows = table(section7(), "Axis weights");
    expect(rows.map((r) => r[0].split(" ")[0])).toEqual([...AXES]);
    for (const [axis, weight, cap] of rows) {
      const a = axis.split(" ")[0] as (typeof AXES)[number];
      expect(Number(weight.replace("%", "")) / 100, a).toBeCloseTo(raw.axes[a], 10);
      expect(Number(cap), a).toBe(raw.caps[a]);
    }
  });

  it("parsed points table = every kind and its points in the file", () => {
    const rows = table(section7(), "Points per signal kind");
    const fromDoc = rows.map(([axis, kind, pts]) => `${axis}/${kind}=${Number(pts)}`).sort();
    const fromFile = AXES.flatMap((a) => Object.entries(raw.points[a]).map(([k, v]) => `${a}/${k}=${v}`)).sort();
    expect(fromDoc).toEqual(fromFile);
  });

  it("parsed parameter table holds the guard, labels, claims rate and ruling hints", () => {
    const rows = Object.fromEntries(table(section7(), "Other parameters").map(([k, v]) => [k, v]));
    expect(Number(rows["llmGuard.maxShare"])).toBe(raw.llmGuard.maxShare);
    expect(Number(rows["labels.moderateFrom"])).toBe(raw.labels.moderateFrom);
    expect(Number(rows["labels.highFrom"])).toBe(raw.labels.highFrom);
    expect(Number(rows["claimsRate.perWords"])).toBe(raw.claimsRate.perWords);
    expect(Number(rows["regulatorRuling.upheldMultiplier"])).toBe(raw.regulatorRuling.upheldMultiplier);
    expect(rows["confidence.axisSteps.track"]).toBe(raw.confidence.axisSteps.track.join(", "));
  });
});
