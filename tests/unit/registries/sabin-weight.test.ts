import { describe, expect, it } from "vitest";
import { caseWeightHint, statusMultiplier } from "@/lib/registries/sabin";
import { signalPoints } from "@/lib/score/scorer";
import { WEIGHTS, WeightsSchema, type Weights } from "@/lib/score/weights";
import raw from "../../../config/weights.json";

const NOW = new Date("2026-10-21T12:00:00Z");
const OLD = "2020-01-01";

describe("litigation.case status multipliers (13.4) and points below rulings (13.7)", () => {
  it("“Dismissed” ⇒ 0 (listed, 0 points); “Pending” ⇒ 1; “Decided” ⇒ 1; unknown ⇒ 1", () => {
    expect(caseWeightHint({ status: "Dismissed", last_event: "Decision (2021-01-01)", filed_date: OLD }, NOW)).toBe(0);
    expect(caseWeightHint({ status: "Pending", last_event: "Complaint (2021-01-01)", filed_date: OLD }, NOW)).toBe(1);
    expect(caseWeightHint({ status: "Decided", last_event: "Decision (2021-01-01)", filed_date: OLD }, NOW)).toBe(1);
    expect(caseWeightHint({ status: "unknown", last_event: "unknown", filed_date: null }, NOW)).toBe(1);
    expect(signalPoints({ axis: "track", kind: "litigation.case", weight_hint: 0 })).toBe(0);
  });

  it("unknown status falls back to the last event: “Withdrawn (…)” ⇒ 0; “Struck out” ⇒ 0", () => {
    expect(statusMultiplier({ status: "unknown", last_event: "Withdrawn (2022-05-01)" })).toBe(0);
    expect(statusMultiplier({ status: "Struck out", last_event: "unknown" })).toBe(0);
  });

  it("recent filing (within regulatorRuling.recentYears) ⇒ × recentMultiplier", () => {
    expect(caseWeightHint({ status: "Pending", last_event: "unknown", filed_date: "2025-01-01" }, NOW)).toBe(WEIGHTS.regulatorRuling.recentMultiplier);
  });

  it("keywords are read from config/weights.json", () => {
    const w: Weights = WeightsSchema.parse({ ...raw, litigation: { ...raw.litigation, statusMultipliers: [{ keywords: ["pending"], multiplier: 0 }] } });
    expect(statusMultiplier({ status: "Pending", last_event: "unknown" }, w.litigation)).toBe(0);
    expect(caseWeightHint({ status: "Pending", last_event: "unknown", filed_date: OLD }, NOW, w)).toBe(0);
  });

  it("pinned: litigation.case points (10) < regulator.ruling points (25); a filed case is not a ruling", () => {
    expect(WEIGHTS.points.track["litigation.case"]).toBe(10);
    expect(WEIGHTS.points.track["litigation.case"]).toBeLessThan(WEIGHTS.points.track["regulator.ruling"]);
    expect(WEIGHTS.confidence.axisSteps.track).toContain("sabin");
  });
});
