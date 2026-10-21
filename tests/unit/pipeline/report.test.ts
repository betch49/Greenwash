import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReportsRepo } from "@/lib/db/reports-repo";
import { RunOutputsRepo } from "@/lib/db/run-outputs-repo";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import { runPipeline } from "@/lib/pipeline/run";
import { discoverStep } from "@/lib/pipeline/steps/discover";
import { fetchPagesStep } from "@/lib/pipeline/steps/fetch-pages";
import { claimsStep } from "@/lib/pipeline/steps/claims";
import { ReportV1Schema } from "@/lib/score/report";
import { OfflineFetcher } from "../helpers/brands";
import { tempDb } from "../helpers/db";

const NOW = () => new Date("2026-10-20T12:00:00Z");

describe("report persistence (Phase 6 deliverable 6)", () => {
  let env: ReturnType<typeof tempDb>;
  let runs: RunsRepo;
  beforeEach(() => {
    env = tempDb();
    runs = new RunsRepo(env.db);
  });
  afterEach(() => env.cleanup());

  const northwind = () => runs.create({ query: "northwind outdoor", brand: "Northwind Outdoor Ltd.", website: "https://www.northwind-outdoor.example" });

  it("a done run stores one ReportV1 in the reports table, with step statuses and skipped steps", async () => {
    const run = northwind();
    const reports = new ReportsRepo(env.db);
    const out = await runPipeline(run, { runs, pages: new RunPagesRepo(env.db), outputs: new RunOutputsRepo(env.db), reports, fetcher: new OfflineFetcher(), now: NOW, steps: [discoverStep, fetchPagesStep, claimsStep] });
    expect(out.status).toBe("done");
    expect(out.step_status).toEqual({ discover: "done", fetchPages: "done", claims: "done" });
    const stored = reports.getByRun(run.id)!;
    expect(stored.id).toBe(out.report_id);
    expect(ReportV1Schema.parse(stored.report)).toEqual(out.report);
    expect(stored.report.generated_at).toBe(NOW().toISOString());
    // Only the claims axis ran: confidence = its weight.
    expect(stored.report.confidence).toBe(25);
    expect(stored.report.skipped).toEqual(out.progress.filter((p) => p.status === "skipped").map((p) => ({ step: p.step, reason: p.reason })));
    expect(stored.report.skipped.length).toBeGreaterThan(0);
  });

  it("a run that fails at pipeline level still persists its could-not-check lines (Phase 4 review carry-forward); no report", async () => {
    const run = northwind();
    const outputs = new RunOutputsRepo(env.db);
    const reports = new ReportsRepo(env.db);
    const pages = new RunPagesRepo(env.db);
    pages.replace = () => {
      throw new Error("disk full");
    };
    const out = await runPipeline(run, { runs, pages, outputs, reports, fetcher: new OfflineFetcher(), now: NOW, steps: [discoverStep, fetchPagesStep] });
    expect(out.status).toBe("failed");
    expect(runs.get(run.id)!.status).toBe("failed");
    expect(out.could_not_check.length).toBeGreaterThan(0);
    expect(outputs.get(run.id).could_not_check).toEqual(out.could_not_check);
    expect(outputs.get(run.id).could_not_check.some((l) => l.includes("robots.txt"))).toBe(true);
    expect(reports.getByRun(run.id)).toBeUndefined();
    expect(out.report).toBeUndefined();
  });
});
