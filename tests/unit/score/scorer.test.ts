import { describe, expect, it } from "vitest";
import { axisSubscore, effectiveWeights, labelFor, score, signalPoints, weightedSum } from "@/lib/score/scorer";
import { confidenceOf } from "@/lib/score/confidence";
import { WEIGHTS, WeightsSchema } from "@/lib/score/weights";
import raw from "../../../config/weights.json";
import { ALL_DONE, signal } from "./random";

const base = { words_scanned: 1000, step_status: ALL_DONE, archived_snapshots: 0 };

describe("weighted sum (6.1)", () => {
  it("sub-scores 40, 20, 80, 10 with 25/25/30/20 ⇒ 10 + 5 + 24 + 2 = 41", () => {
    expect(WEIGHTS.axes).toEqual({ claims: 0.25, evidence: 0.25, track: 0.3, repair: 0.2 });
    const sum = weightedSum({ claims: 40, evidence: 20, track: 80, repair: 10 }, WEIGHTS.axes);
    expect(sum).toBeCloseTo(41, 10);
    expect(Math.round(sum)).toBe(41);
  });

  it("the scorer reproduces 41 end to end from signals that give those sub-scores", () => {
    // claims: 40 = points × 1000/1000 × 15 ⇒ points = 8/3 — use hints; evidence 20; track 80; repair 10.
    const perPoint = WEIGHTS.claimsRate.subscorePerPointPer1000Words;
    const signals = [
      signal({ axis: "claims", kind: "claim.unsupported", weight_hint: 40 / perPoint }),
      signal({ axis: "evidence", kind: "evidence.no_report_found", weight_hint: 20 / WEIGHTS.points.evidence["evidence.no_report_found"] }),
      signal({ axis: "track", kind: "claim.removed", weight_hint: 80 / WEIGHTS.points.track["claim.removed"] }),
      signal({ axis: "repair", kind: "repair.no_repair_info_found", weight_hint: 10 / WEIGHTS.points.repair["repair.no_repair_info_found"] }),
    ];
    const r = score({ ...base, signals });
    expect(r.axes.map((a) => a.subscore)).toEqual([40, 20, 80, 10]);
    expect(r.score).toBe(41);
    expect(r.confidence).toBe(100);
    expect(r.label).toBe("moderate");
    expect(r.label_text).toBe("Moderate signals");
  });
});

describe("points, caps and rates (config/weights.json)", () => {
  it("claim.supported is worth strictly less than claim.unsupported (ADR-015)", () => {
    expect(WEIGHTS.points.claims["claim.supported"]).toBeLessThan(WEIGHTS.points.claims["claim.unsupported"]);
    expect(WEIGHTS.points.claims["claim.supported"]).toBeGreaterThan(0);
  });

  it("repair.no_repair_info_found is a moderate risk (absence of information), below the axis cap; ifixit_guides ≤ manual / spare parts (ADR-018)", () => {
    const p = WEIGHTS.points.repair;
    expect(p["repair.no_repair_info_found"]).toBeGreaterThan(0);
    expect(p["repair.no_repair_info_found"]).toBeLessThan(WEIGHTS.caps.repair);
    expect(p["repair.ifixit_guides"]).toBeLessThanOrEqual(p["repair.manual_found"]);
    expect(p["repair.ifixit_guides"]).toBeLessThanOrEqual(p["repair.spare_parts_found"]);
  });

  it("protective kinds carry 0 points; their risk alternatives carry more", () => {
    for (const k of ["evidence.report_found", "evidence.report_found_undated", "evidence.absolute_emissions_found", "evidence.supplier_list_found"]) expect(WEIGHTS.points.evidence[k], k).toBe(0);
    expect(WEIGHTS.points.evidence["evidence.no_report_found"]).toBeGreaterThan(WEIGHTS.points.evidence["evidence.stale_report"]);
    expect(WEIGHTS.points.evidence["evidence.stale_report"]).toBeGreaterThan(0);
  });

  it("points = kind points × weight_hint; unknown kinds and negative hints score 0", () => {
    expect(signalPoints({ axis: "track", kind: "regulator.ruling", weight_hint: 2 })).toBe(WEIGHTS.points.track["regulator.ruling"] * 2);
    expect(signalPoints({ axis: "track", kind: "no.such.kind", weight_hint: 5 })).toBe(0);
    expect(signalPoints({ axis: "track", kind: "claim.removed", weight_hint: -3 })).toBe(0);
    expect(signalPoints({ axis: "track", kind: "claim.removed", weight_hint: Number.NaN })).toBe(0);
  });

  it("claims axis is a per-1,000-word rate with a minimum word count, capped at 100", () => {
    const k = WEIGHTS.claimsRate.subscorePerPointPer1000Words;
    expect(axisSubscore("claims", 2, 2000)).toBeCloseTo(k, 10);
    expect(axisSubscore("claims", 2, 10)).toBeCloseTo((2 * 1000 * k) / WEIGHTS.claimsRate.minWords, 10);
    expect(axisSubscore("claims", 1e6, 1000)).toBe(100);
    expect(axisSubscore("track", 1e6, 0)).toBe(WEIGHTS.caps.track);
  });

  it("ClaimStats, when given, are the claims-axis input: repeats count, supported matches at the lower rate", () => {
    const stats = { matches: 10, unsupported: 6, wordCount: 2000 };
    const r = score({ ...base, signals: [signal({ axis: "claims", kind: "claim.unsupported" })], claim_stats: stats });
    const pts = 6 * WEIGHTS.points.claims["claim.unsupported"] + 4 * WEIGHTS.points.claims["claim.supported"];
    expect(r.axes[0].subscore).toBe(Math.round(((pts * 1000) / 2000) * WEIGHTS.claimsRate.subscorePerPointPer1000Words));
  });

  it("labels follow labels.moderateFrom / labels.highFrom", () => {
    expect(labelFor(WEIGHTS.labels.moderateFrom - 1)).toBe("low");
    expect(labelFor(WEIGHTS.labels.moderateFrom)).toBe("moderate");
    expect(labelFor(WEIGHTS.labels.highFrom)).toBe("high");
  });

  it("the weights file passes its schema; a file with negative points, a weight sum ≠ 1 or maxShare > 0.5 is rejected", () => {
    expect(WeightsSchema.safeParse(raw).success).toBe(true);
    const bad1 = structuredClone(raw) as typeof raw;
    bad1.points.track["claim.removed"] = -1;
    expect(WeightsSchema.safeParse(bad1).success).toBe(false);
    const bad2 = structuredClone(raw) as typeof raw;
    bad2.axes.track = 0.4;
    expect(WeightsSchema.safeParse(bad2).success).toBe(false);
    const bad3 = structuredClone(raw) as typeof raw;
    bad3.llmGuard.maxShare = 0.6;
    expect(WeightsSchema.safeParse(bad3).success).toBe(false);
  });
});

describe("missing and not-applicable axes", () => {
  it("not_applicable repair ⇒ its weight is shared out in proportion; confidence unaffected", () => {
    const eff = effectiveWeights(["repair"]);
    expect(eff.repair).toBe(0);
    expect(eff.claims).toBeCloseTo(0.25 / 0.8, 12);
    expect(eff.track).toBeCloseTo(0.3 / 0.8, 12);
    const signals = [
      signal({ axis: "claims", kind: "claim.unsupported" }),
      signal({ axis: "evidence", kind: "evidence.report_found" }),
      signal({ axis: "track", kind: "regulator.ruling" }),
      signal({ axis: "repair", kind: "repair.no_repair_info_found" }),
    ];
    const r = score({ ...base, signals, repair_axis: "not_applicable" });
    expect(r.confidence).toBe(100);
    const repair = r.axes.find((a) => a.id === "repair")!;
    expect(repair).toMatchObject({ status: "not_applicable", effective_weight: 0, subscore: 0, signals: [] });
    expect(r.signals_count).toBe(3);
  });

  it("an axis with no signal contributes 0 and lowers confidence by its weight", () => {
    const signals = [signal({ axis: "claims", kind: "claim.unsupported" }), signal({ axis: "evidence", kind: "evidence.no_report_found" }), signal({ axis: "repair", kind: "repair.warranty_found" })];
    const r = score({ ...base, signals });
    const track = r.axes.find((a) => a.id === "track")!;
    expect(track).toMatchObject({ status: "missing", subscore: 0 });
    expect(r.confidence).toBe(70);
  });

  it("an axis whose steps were all skipped does not count for confidence even with signals", () => {
    const signals = [signal({ axis: "track", kind: "claim.removed" })];
    const r = score({ ...base, signals, step_status: { ...ALL_DONE, wayback: "skipped", "asa-uk": "skipped", "jdp-fr": "skipped" } });
    expect(r.axes.find((a) => a.id === "track")!.status).toBe("missing");
  });

  it("archived snapshots read count as track data (timelineCountsAsData)", () => {
    const r = score({ ...base, signals: [], archived_snapshots: 2 });
    expect(r.axes.find((a) => a.id === "track")!.status).toBe("scored");
    expect(r.confidence).toBe(30);
  });

  it("no signals at all ⇒ score 0, confidence 0, Low signals", () => {
    const r = score({ ...base, signals: [] });
    expect(r).toMatchObject({ score: 0, confidence: 0, ai_share: 0, label: "low", signals_count: 0, sources_count: 0, basis: "Based on 0 verified signals from 0 sources." });
  });

  it("confidenceOf sums effective weights of scored axes", () => {
    expect(confidenceOf([{ effective_weight: 0.25, status: "scored" }, { effective_weight: 0.25, status: "scored" }, { effective_weight: 0.2, status: "scored" }, { effective_weight: 0.3, status: "missing" }])).toBe(70);
  });
});

describe("basis line", () => {
  it("counts verified signals and distinct source hosts", () => {
    const signals = [
      signal({ axis: "claims", kind: "claim.unsupported", source_url: "https://www.brand.example/a" }),
      signal({ axis: "claims", kind: "claim.unsupported", source_url: "https://www.brand.example/b" }),
      signal({ axis: "track", kind: "regulator.ruling", source_url: "https://www.asa.org.uk/rulings/x.html" }),
    ];
    const r = score({ ...base, signals });
    expect(r.basis).toBe("Based on 3 verified signals from 2 sources.");
    expect(r.signals_count).toBe(3);
    expect(r.sources_count).toBe(2);
  });
});

describe("every signal kind the pipeline emits has points in config/weights.json", () => {
  it("scans src/lib for kind strings and finds each under its axis", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith(".ts") ? [join(d, n)] : []));
    const kinds = new Set<string>();
    for (const f of walk("src/lib").filter((f) => !f.includes("/copy/") && !f.includes("/score/"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/"((?:claim|evidence|repair|regulator)\.[a-z_]+)"/g)) kinds.add(m[1]);
    }
    expect(kinds.size).toBeGreaterThanOrEqual(18);
    const all = new Set(Object.values(WEIGHTS.points).flatMap((t) => Object.keys(t)));
    for (const k of kinds) expect(all.has(k), k).toBe(true);
  });
});
