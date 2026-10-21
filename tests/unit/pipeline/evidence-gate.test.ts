// QA-3 (Phase 14): our own fetch gap must not score as a brand fault. Without a sustainability-type
// page the evidence absence kinds are not emitted; the axis is "no data" with a could-not-check line.
import { describe, expect, it } from "vitest";
import { couldNotCheck, reasons, steps } from "@/lib/copy/wording";
import { DISCOVERY_CONFIG } from "@/lib/discover/heuristics";
import { evidenceStep } from "@/lib/pipeline/steps/evidence";
import type { PipelineContext } from "@/lib/pipeline/types";
import { score } from "@/lib/score/scorer";
import { ALL_DONE } from "../score/random";

const page = (url: string, text = "About our company. Careers. Contact us.", links: { href: string; text: string }[] = []) =>
  ({ url, title: url, text, html: "", links, wordCount: 500, fetchedAt: "2026-10-20T12:00:00Z", status: 200 }) as never;
const ctx = (pages: unknown[]) => ({ pages, config: DISCOVERY_CONFIG, run: { id: "r", brand: "Signify-style", website: "https://www.lighting.example/" } }) as unknown as PipelineContext;

describe("evidence axis without a sustainability-type page (QA-3)", () => {
  it("Signify-style: only the home and about pages fetched ⇒ step skipped with the reason, could-not-check line, no absence signal", async () => {
    const out = await evidenceStep.run(ctx([page("https://www.lighting.example/"), page("https://www.lighting.example/about-us")]));
    expect(out.signals).toEqual([]);
    expect(out.skipped).toEqual({ step: steps.evidence, reason: reasons.noSustainabilityPageForEvidence });
    expect(out.could_not_check).toContain(couldNotCheck.evidenceNotChecked);
    // Scored: the axis is "no data" (0 points) and confidence is lower than with the step done.
    const base = { signals: [], words_scanned: 1000, archived_snapshots: 0 };
    const r = score({ ...base, step_status: { ...ALL_DONE, evidence: "skipped" } });
    expect(r.axes.find((a) => a.id === "evidence")).toMatchObject({ status: "missing", subscore: 0 });
    expect(r.confidence).toBeLessThan(100);
  });

  it("with a sustainability-type page and no report link, the absence signal is emitted as before", async () => {
    const out = await evidenceStep.run(ctx([page("https://www.lighting.example/sustainability")]));
    expect(out.skipped).toBeUndefined();
    expect(out.signals.map((s) => s.kind)).toContain("evidence.no_report_found");
    expect(out.could_not_check).not.toContain(couldNotCheck.evidenceNotChecked);
  });

  it("a protective finding on a non-sustainability page is kept (0 points, counts as data); only the absence kind is dropped", async () => {
    const out = await evidenceStep.run(ctx([page("https://www.lighting.example/about", "Our annual sustainability report 2025 is available.", [{ href: "https://www.lighting.example/files/sustainability-report-2025.pdf", text: "Sustainability report 2025" }])]));
    expect(out.skipped).toBeUndefined();
    expect(out.signals.map((s) => s.kind)).toContain("evidence.report_found");
    expect(out.signals.some((s) => s.kind === "evidence.no_report_found")).toBe(false);
    expect(out.could_not_check).toContain(couldNotCheck.evidenceNotChecked);
  });
});
