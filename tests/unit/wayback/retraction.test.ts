import { describe, expect, it } from "vitest";
import { assertReceipt } from "@/lib/pipeline/signal";
import { detectRetractions } from "@/lib/wayback/retraction";
import type { Snapshot } from "@/lib/wayback/snapshot";
import { NORTHWIND_FOOTPRINT, QUILLMOOR_SUSTAINABILITY, fixtureHistory } from "./history";

const snap = (year: number, text: string): Snapshot => ({
  pageUrl: "https://a.example/sustainability",
  timestamp: `${year}0601000000`,
  year,
  date: `${year}-06-01`,
  snapshotUrl: `https://web.archive.org/web/${year}0601000000id_/https://a.example/sustainability`,
  original: "https://a.example/sustainability",
  title: "Sustainability",
  text,
  fetchedAt: "2026-10-20T00:00:00.000Z",
});

describe("retraction detector on the removed-claim fixture (4.4, fictional Northwind)", () => {
  it("exactly one claim.removed signal, receipt = the 2021 snapshot on web.archive.org", async () => {
    const history = await fixtureHistory(NORTHWIND_FOOTPRINT);
    expect(history.map((s) => s.year)).toEqual([2020, 2021, 2024, 2025]);

    const res = detectRetractions(history, { brand: "Northwind Outdoor Ltd." });
    expect(res.signals).toHaveLength(1);
    const [s] = res.signals;
    expect(() => assertReceipt(s)).not.toThrow();
    expect(s).toMatchObject({ axis: "track", kind: "claim.removed", llm_used: false });
    expect(s.snapshot_date).toMatch(/^2021-\d{2}-\d{2}$/);
    expect(new URL(s.source_url).host).toBe("web.archive.org");
    expect(s.source_url).toBe("https://web.archive.org/web/20210315141503id_/https://www.northwind-outdoor.example/our-footprint/");
    expect(s.excerpt).toContain("climate neutral");
    expect(s.label).toBe("Claim removed between 2021 and 2024: present in the 2021 archived copy of the page, absent from the 2024 copy");

    // A Phase 7 candidate goes with it, unclassified, with context from both snapshots.
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]).toMatchObject({ signalId: s.id, classification: "unclassified", ruleIds: ["offset"] });
    expect(res.candidates[0].from.before.length).toBeGreaterThan(0);
    expect(res.candidates[0].to.nearestSimilarity).toBeLessThan(0.8);
  });

  it("the timeline lists every snapshot with its claims, and the removal at the year it disappeared", async () => {
    const res = detectRetractions(await fixtureHistory(NORTHWIND_FOOTPRINT), { brand: "Northwind Outdoor Ltd." });
    expect(res.timeline.map((t) => [t.year, t.claims_removed.length, t.previous_year])).toEqual([
      [2020, 0, undefined],
      [2021, 0, 2020],
      [2024, 1, 2021],
      [2025, 0, 2024],
    ]);
    const y2021 = res.timeline[1];
    const y2024 = res.timeline[2];
    expect(y2021.claims_present.some((c) => c.includes("climate neutral"))).toBe(true);
    expect(y2024.claims_present.some((c) => c.includes("climate neutral"))).toBe(false);
    expect(y2024.claims_present).toContain("We are carbon neutral.");
    expect(y2024.claims_removed[0]).toContain("Every Northwind jacket is climate neutral");
    for (const t of res.timeline) expect(new URL(t.snapshot_url).host).toBe("web.archive.org");
  });
});

describe("retraction detector on the redesign fixture (4.5, fictional Quillmoor)", () => {
  it("same claims in new markup (heading instead of sentence, reworded, moved) ⇒ zero claim.removed", async () => {
    const history = await fixtureHistory(QUILLMOOR_SUSTAINABILITY);
    expect(history.map((s) => s.year)).toEqual([2020, 2022, 2025]);
    const res = detectRetractions(history, { brand: "Quillmoor Foods Ltd." });
    expect(res.signals).toEqual([]);
    expect(res.candidates).toEqual([]);
    // The claims are there in every snapshot, so the timeline still shows them.
    for (const t of res.timeline) expect(t.claims_present.length).toBeGreaterThanOrEqual(3);
  });
});

describe("retraction rules", () => {
  it("a removed sentence that matches no claim rule is not a signal", () => {
    const res = detectRetractions([snap(2021, "We make oat drinks.\nOur plant has 40 staff."), snap(2023, "We make oat drinks.")]);
    expect(res.signals).toEqual([]);
  });

  it("a reworded claim (similarity ≥ 0.8) is not a removal; a different claim is", () => {
    const before = "Our packaging is eco-friendly.\nAll our cartons are carbon neutral.";
    const reworded = detectRetractions([snap(2021, before), snap(2023, "Our packaging is eco friendly!\nAll of our cartons are carbon neutral.")]);
    expect(reworded.signals).toEqual([]);
    const removed = detectRetractions([snap(2021, before), snap(2023, "Our packaging is eco-friendly.\nWe publish our carton data.")]);
    expect(removed.signals.map((s) => s.excerpt)).toEqual(["All our cartons are carbon neutral."]);
  });

  it("a claim removed, restored and removed again gives one signal (the first removal)", () => {
    const claim = "Our cartons are carbon neutral.";
    const res = detectRetractions([snap(2020, claim), snap(2021, "Hello."), snap(2022, claim), snap(2023, "Hello.")]);
    expect(res.signals).toHaveLength(1);
    expect(res.signals[0].snapshot_date).toBe("2020-06-01");
    expect(res.timeline.filter((t) => t.claims_removed.length > 0).map((t) => t.year)).toEqual([2021, 2023]);
  });

  it("snapshots are compared in time order whatever order they arrive in; one snapshot ⇒ nothing to compare", () => {
    const res = detectRetractions([snap(2023, "Hello."), snap(2021, "Our cartons are carbon neutral.")]);
    expect(res.signals).toHaveLength(1);
    expect(detectRetractions([snap(2021, "Our cartons are carbon neutral.")]).signals).toEqual([]);
  });
});
