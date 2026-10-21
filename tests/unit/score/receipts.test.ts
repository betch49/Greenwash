import { describe, expect, it, vi } from "vitest";
import { ReceiptError } from "@/lib/pipeline/signal";
import { score } from "@/lib/score/scorer";
import { buildReport } from "@/lib/score/report";
import { ALL_DONE, signal } from "./random";

const good = signal({ axis: "track", kind: "claim.removed" });
const noUrl = signal({ axis: "track", kind: "claim.removed", source_url: "" });
const noDate = signal({ axis: "track", kind: "regulator.ruling", fetched_at: "" });
const noExcerpt = signal({ axis: "claims", kind: "claim.unsupported", excerpt: "  " });
const input = { signals: [good, noUrl, noDate, noExcerpt], words_scanned: 1000, step_status: ALL_DONE, archived_snapshots: 0 };

describe("the scorer enforces receipts (6.4)", () => {
  it("throws in development mode", () => {
    expect(() => score(input, { mode: "dev" })).toThrow(ReceiptError);
  });

  it("filters and logs in production mode; rejected signals are absent from ReportV1.axes[].signals and from the score", () => {
    const log = vi.fn();
    const outcome = { signals: input.signals, pages: [], repair_axis: undefined, step_status: ALL_DONE, timeline: [], could_not_check: ["x"], progress: [] };
    const report = buildReport({ id: "run-1", brand: "Brand", website: "https://brand.example/" }, outcome, new Date("2026-10-21T00:00:00Z"), { mode: "prod", log });
    const ids = report.axes.flatMap((a) => a.signals.map((s) => s.id));
    expect(ids).toEqual([good.id]);
    for (const bad of [noUrl, noDate, noExcerpt]) expect(ids).not.toContain(bad.id);
    expect(log).toHaveBeenCalledTimes(3);
    expect(report.signals_count).toBe(1);
    const only = score({ ...input, signals: [good] }, { mode: "prod" });
    expect(report.score).toBe(only.score);
  });

  it("the default mode outside production is development (throws)", () => {
    expect(() => score(input)).toThrow(/scorer: signal rejected/);
  });
});
