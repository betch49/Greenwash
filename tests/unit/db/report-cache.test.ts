import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReportsRepo } from "@/lib/db/reports-repo";
import { RunOutputsRepo } from "@/lib/db/run-outputs-repo";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import { runPipeline } from "@/lib/pipeline/run";
import { DEFAULT_REPORT_TTL_HOURS, freshReportId, reportTtlHours, websiteKeys } from "@/lib/report/cache";
import { ReportV1Schema, type ReportV1 } from "@/lib/score/report";
import { OfflineFetcher } from "../helpers/brands";
import { tempDb } from "../helpers/db";

const NOW = new Date("2026-10-20T12:00:00Z");
const NORTHWIND = "https://www.northwind-outdoor.example";
const nw = { website: NORTHWIND, brand: "Northwind Outdoor Ltd.", wikidataId: null };

describe("report cache (8.5, PLAN Phase 8 deliverable 2)", () => {
  let env: ReturnType<typeof tempDb>;
  let reports: ReportsRepo;
  let report: ReportV1;
  let id: string;

  beforeEach(async () => {
    env = tempDb();
    reports = new ReportsRepo(env.db);
    const runs = new RunsRepo(env.db);
    const run = runs.create({ query: "northwind outdoor", brand: "Northwind Outdoor Ltd.", website: NORTHWIND });
    const out = await runPipeline(run, { runs, pages: new RunPagesRepo(env.db), outputs: new RunOutputsRepo(env.db), reports, fetcher: new OfflineFetcher(), now: () => NOW });
    expect(out.status).toBe("done");
    id = out.report_id!;
    report = out.report!;
  });
  afterEach(() => env.cleanup());

  it("getReport(id) returns the stored ReportV1 in < 1000 ms (average over 100 reads)", () => {
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) expect(reports.get(id)?.run_id).toBe(report.run_id);
    const avg = (performance.now() - t0) / 100;
    expect(avg).toBeLessThan(1000);
    expect(ReportV1Schema.parse(reports.get(id))).toEqual(report);
  });

  it("the raw export is exactly the stored JSON and parses as ReportV1", () => {
    const raw = reports.getRaw(id)!;
    expect(ReportV1Schema.parse(JSON.parse(raw))).toEqual(report);
    expect(reports.getRaw("00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });

  it("a report younger than the TTL is re-served for the same website; older, other website or TTL 0 ⇒ none", () => {
    expect(freshReportId(reports, nw, new Date("2026-10-21T12:00:00Z"), 168)).toBe(id);
    expect(freshReportId(reports, nw, new Date("2026-10-27T12:00:00Z"), 168)).toBe(id);
    expect(freshReportId(reports, nw, new Date("2026-10-27T12:00:01Z"), 168)).toBeUndefined();
    expect(freshReportId(reports, { ...nw, website: "https://www.quillmoor-foods.example" }, NOW, 168)).toBeUndefined();
    expect(freshReportId(reports, nw, NOW, 0)).toBeUndefined();
  });

  it("another identity for the same website is not served: a different typed name, or a Wikidata entity", () => {
    expect(freshReportId(reports, { ...nw, brand: "northwind outdoor ltd." }, NOW, 168)).toBe(id);
    expect(freshReportId(reports, { ...nw, brand: "acme" }, NOW, 168)).toBeUndefined();
    expect(freshReportId(reports, { website: NORTHWIND, wikidataId: "Q1" }, NOW, 168)).toBeUndefined();
  });

  it("a trailing slash or a pasted spelling of the same website finds the same report", () => {
    expect(freshReportId(reports, { ...nw, website: `${NORTHWIND}/` }, NOW, 168)).toBe(id);
    expect(websiteKeys("https://www.oatly.com/")).toEqual(["https://www.oatly.com/", "https://www.oatly.com"]);
    expect(websiteKeys("https://www.mammut.com/us/en/")).toEqual(["https://www.mammut.com/us/en/", "https://www.mammut.com/us/en"]);
  });

  it("the newest of several fresh reports wins", () => {
    const newer = reports.save({ ...report, generated_at: "2026-10-20T13:00:00.000Z" });
    expect(freshReportId(reports, nw, new Date("2026-10-20T14:00:00Z"), 168)).toBe(newer);
  });

  it("GR_REPORT_TTL_HOURS: default 168, numbers ≥ 0 honoured, garbage ignored", () => {
    expect(DEFAULT_REPORT_TTL_HOURS).toBe(168);
    expect(reportTtlHours({})).toBe(168);
    expect(reportTtlHours({ GR_REPORT_TTL_HOURS: "" })).toBe(168);
    expect(reportTtlHours({ GR_REPORT_TTL_HOURS: "24" })).toBe(24);
    expect(reportTtlHours({ GR_REPORT_TTL_HOURS: "0" })).toBe(0);
    expect(reportTtlHours({ GR_REPORT_TTL_HOURS: "-3" })).toBe(168);
    expect(reportTtlHours({ GR_REPORT_TTL_HOURS: "soon" })).toBe(168);
  });
});
