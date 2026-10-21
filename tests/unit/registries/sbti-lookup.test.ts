import { describe, expect, it } from "vitest";
import { SBTI_CONFIG, isNeutralRemoval, lookupSbti, removalWeightHint, sbtiSignals, type SbtiRow } from "@/lib/registries/sbti";
import { signalPoints } from "@/lib/score/scorer";
import { WEIGHTS } from "@/lib/score/weights";
import { receiptProblem } from "@/lib/pipeline/signal";
import { sbtiRows } from "../helpers/sbti";

const NOW = new Date("2026-10-21T12:00:00Z");
const RECEIPT = { url: SBTI_CONFIG.exportUrl, fetchedAt: "2026-10-21T07:41:00.000Z" };

async function signalsFor(brand: string, ids?: { isins: string[]; leis: string[] }) {
  const found = lookupSbti(brand, await sbtiRows(), ids);
  return { found, signals: found.scored.flatMap((r) => sbtiSignals(r, RECEIPT, NOW)) };
}

describe("SBTi lookup and signals (11.2)", () => {
  it("Amazon (Commitment Removed, Expired commitment) ⇒ exactly one sbti.commitment_removed with receipt and entity verbatim", async () => {
    const { signals } = await signalsFor("Amazon");
    expect(signals.map((s) => s.kind)).toEqual(["sbti.commitment_removed"]);
    const [s] = signals;
    expect(receiptProblem(s)).toBeNull();
    expect(s).toMatchObject({ axis: "track", entity_name: "Amazon", source_url: SBTI_CONFIG.exportUrl, fetched_at: RECEIPT.fetchedAt, llm_used: false });
    // Updated 2020-06-18: older than recentYears; reason "Expired commitment" × expiredMultiplier.
    expect(s.weight_hint).toBe(WEIGHTS.defaultWeightHint * WEIGHTS.sbti.expiredMultiplier);
    expect(signalPoints(s)).toBe(WEIGHTS.points.track["sbti.commitment_removed"] * s.weight_hint);
    expect(signalPoints(s)).toBeGreaterThan(0);
  });

  it("Fairphone (“Fairphone B.V”, Validated Targets) ⇒ sbti.targets_validated with 0 points in the scorer", async () => {
    const { signals } = await signalsFor("Fairphone");
    expect(signals.map((s) => s.kind)).toEqual(["sbti.targets_validated"]);
    expect(signals[0].entity_name).toBe("Fairphone B.V");
    expect(signalPoints(signals[0])).toBe(0);
  });

  it("“Target set at parent company level” (Austrian Post) and “Company change” (Activision Blizzard) ⇒ sbti.status_note, 0 points", async () => {
    for (const brand of ["Austrian Post", "Activision Blizzard"]) {
      const { signals } = await signalsFor(brand);
      expect(signals.map((s) => s.kind), brand).toEqual(["sbti.status_note"]);
      expect(signalPoints(signals[0])).toBe(0);
    }
  });

  it("Unilever plc: near-term validated, net-zero removed (Expired) ⇒ a removal and a validated-targets signal", async () => {
    const { signals } = await signalsFor("Unilever");
    expect(signals.map((s) => s.kind).sort()).toEqual(["sbti.commitment_removed", "sbti.targets_validated"]);
    expect(signals.find((s) => s.kind === "sbti.commitment_removed")!.label).toContain("net-zero status “Commitment Removed”");
  });

  it("ALDI Nord Group (Commitment to Set Targets) ⇒ sbti.commitment_pending, 0 points", async () => {
    const { signals } = await signalsFor("ALDI Nord Group");
    expect(signals.map((s) => s.kind)).toEqual(["sbti.commitment_pending"]);
    expect(signalPoints(signals[0])).toBe(0);
  });

  it("a whole-word-only name ⇒ possible, not a signal (Mammut vs “Mammut Sports Group”, Coca-Cola)", async () => {
    const mammut = await signalsFor("Mammut");
    expect(mammut.signals).toEqual([]);
    expect(mammut.found.possible.map((r) => r.company_name)).toEqual(["Mammut Sports Group"]);
    const coke = await signalsFor("Coca-Cola");
    expect(coke.signals).toEqual([]);
    expect(coke.found.possible.length).toBeGreaterThanOrEqual(3);
    // "Nestlé" equals one row; "Nestlé Nespresso" is only possible.
    const nestle = await signalsFor("Nestlé");
    expect(nestle.found.scored.map((r) => r.company_name)).toEqual(["Nestlé"]);
    expect(nestle.found.possible.map((r) => r.company_name)).toEqual(["Nestlé Nespresso"]);
  });

  it("an ISIN (or LEI) match scores even when the name differs", async () => {
    expect((await signalsFor("Amazon.com, Inc.")).signals).toEqual([]);
    const byIsin = await signalsFor("Amazon.com, Inc.", { isins: ["US0231351067"], leis: [] });
    expect(byIsin.signals.map((s) => [s.kind, s.entity_name])).toEqual([["sbti.commitment_removed", "Amazon"]]);
    const byLei = await signalsFor("Amazon.com, Inc.", { isins: [], leis: ["zxtilkjkg63jeloeg630".toUpperCase()] });
    expect(byLei.signals.map((s) => s.kind)).toEqual(["sbti.commitment_removed"]);
  });
});

describe("removal weight_hint and neutral reasons", () => {
  const row = (date_updated: string, status_reason: string) => ({ date_updated, status_reason }) as Pick<SbtiRow, "date_updated" | "status_reason">;
  it("recent (within regulatorRuling.recentYears) × recentMultiplier; Expired × sbti.expiredMultiplier", () => {
    const w = { ...WEIGHTS, sbti: { expiredMultiplier: 0.5 } };
    expect(removalWeightHint(row("2025-01-01", "Withdrawn commitment"), NOW, w)).toBe(w.defaultWeightHint * w.regulatorRuling.recentMultiplier);
    expect(removalWeightHint(row("2019-01-01", "Withdrawn commitment"), NOW, w)).toBe(w.defaultWeightHint);
    expect(removalWeightHint(row("2019-01-01", "Expired commitment"), NOW, w)).toBe(w.defaultWeightHint * 0.5);
    expect(removalWeightHint(row("", "Expired commitment; Withdrawn commitment"), NOW, w)).toBe(w.defaultWeightHint * 0.5);
  });
  it("a removal is neutral only when every listed reason is neutral", () => {
    expect(isNeutralRemoval("Target set at parent company level")).toBe(true);
    expect(isNeutralRemoval("Company change")).toBe(true);
    expect(isNeutralRemoval("Expired commitment; Target set at parent company level")).toBe(false);
    expect(isNeutralRemoval("")).toBe(false);
  });
});
