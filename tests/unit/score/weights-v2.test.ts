import { describe, expect, it } from "vitest";
import raw from "../../../config/weights.json";
import { WEIGHTS, WeightsSchema } from "@/lib/score/weights";
import { score } from "@/lib/score/scorer";
import { SBTI_CONFIG, lookupSbti, sbtiSignals } from "@/lib/registries/sbti";
import type { Signal } from "@/lib/pipeline/signal";
import { sbtiRows } from "../helpers/sbti";

const NOW = new Date("2026-10-21T12:00:00Z");

describe("config/weights.json version 2 (11.4)", () => {
  it("is version 2 with the SBTi kinds on the track axis, sbti.expiredMultiplier and the sbti confidence step", () => {
    expect(WEIGHTS.version).toBe(2);
    expect(WEIGHTS.points.track).toMatchObject({
      "sbti.commitment_removed": raw.points.track["sbti.commitment_removed"],
      "sbti.targets_validated": 0,
      "sbti.commitment_pending": 0,
      "sbti.status_note": 0,
    });
    expect(WEIGHTS.points.track["sbti.commitment_removed"]).toBeGreaterThan(0);
    expect(WEIGHTS.sbti.expiredMultiplier).toBe(raw.sbti.expiredMultiplier);
    expect(WEIGHTS.confidence.axisSteps.track).toContain("sbti");
    expect(() => WeightsSchema.parse({ ...raw, version: 1 })).toThrow();
  });

  it("removing the SBTi removal never raises the score; ai_share is unchanged (no LLM)", async () => {
    const [row] = lookupSbti("Amazon", await sbtiRows()).scored;
    const sbti = sbtiSignals(row, { url: SBTI_CONFIG.exportUrl, fetchedAt: "2026-10-21T07:41:00.000Z" }, NOW);
    expect(sbti.every((s) => s.llm_used === false)).toBe(true);
    const base: Signal = {
      id: "e1",
      axis: "evidence",
      kind: "evidence.no_report_found",
      label: "x",
      weight_hint: 1,
      source_url: "https://brand.example/",
      fetched_at: "2026-10-21T00:00:00.000Z",
      excerpt: "x",
      llm_used: false,
    };
    const input = (signals: Signal[]) => ({ signals, words_scanned: 2000, step_status: { evidence: "done", sbti: "done" } as const, archived_snapshots: 0 });
    const withIt = score(input([base, ...sbti]), { mode: "dev" });
    const without = score(input([base]), { mode: "dev" });
    expect(withIt.score).toBeGreaterThanOrEqual(without.score);
    expect(withIt.axes.find((a) => a.id === "track")!.subscore).toBe(WEIGHTS.points.track["sbti.commitment_removed"] * sbti[0].weight_hint);
    expect(withIt.ai_share).toBe(without.ai_share);
    // The step counts for the track axis' confidence once it produced a signal.
    expect(withIt.axes.find((a) => a.id === "track")!.status).toBe("scored");
    expect(without.axes.find((a) => a.id === "track")!.status).toBe("missing");
  });
});
