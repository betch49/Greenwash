import { describe, expect, it } from "vitest";
import { sbtiWording } from "@/lib/copy/wording";
import { findForbidden } from "@/lib/copy/forbidden";
import { SBTI_CONFIG, lookupSbti, sbtiSignals } from "@/lib/registries/sbti";
import { sbtiRows } from "../helpers/sbti";

const NOW = new Date("2026-10-21T12:00:00Z");
const RECEIPT = { url: SBTI_CONFIG.exportUrl, fetchedAt: "2026-10-21T07:41:00.000Z" };

describe("SBTi receipts and wording (11.5)", () => {
  it("every receipt excerpt carries the attribution line and the status_reason", async () => {
    const rows = await sbtiRows();
    for (const brand of ["Amazon", "Austrian Post", "Fairphone", "Unilever", "Aviva"]) {
      for (const s of lookupSbti(brand, rows).scored.flatMap((r) => sbtiSignals(r, RECEIPT, NOW))) {
        expect(s.excerpt, brand).toContain("Source: Science Based Targets initiative, Target Dashboard export (2026-10-21), https://sciencebasedtargets.org/target-dashboard");
        const row = rows.find((r) => r.company_name === s.entity_name)!;
        expect(s.excerpt).toContain(`status reason: ${row.status_reason || "none given"}`);
        expect(s.excerpt).toContain(row.company_name);
      }
    }
  });

  it("a removal is “commitment removed (as published by SBTi)”, not a verdict; no forbidden word in any SBTi label", async () => {
    const rows = await sbtiRows();
    const signals = rows.flatMap((r) => sbtiSignals(r, RECEIPT, NOW));
    const removed = signals.filter((s) => s.kind === "sbti.commitment_removed");
    expect(removed.length).toBeGreaterThan(0);
    for (const s of removed) expect(s.label).toMatch(/^Commitment removed \(as published by SBTi\) for /);
    for (const s of signals) expect(findForbidden(`${s.label} ${s.excerpt}`), s.label).toEqual([]);
    const lines = [sbtiWording.coverage, sbtiWording.skipped("x"), sbtiWording.possible("A", "b", "https://x.example"), sbtiWording.possibleMore(3), sbtiWording.step, sbtiWording.unparsable];
    for (const l of lines) expect(findForbidden(l), l).toEqual([]);
  });
});
