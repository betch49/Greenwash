import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { ReportV1Schema, type ReportV1 } from "../score/report";
import type { Db } from "./client";
import { reports } from "./schema";

/** Finished reports (ReportV1 JSON, PLAN Phase 6 deliverable 6). */
export class ReportsRepo {
  constructor(private readonly db: Db) {}

  /** Stores a report and returns its id. */
  save(report: ReportV1): string {
    const id = randomUUID();
    this.db.insert(reports).values({ id, runId: report.run_id, brand: report.brand, website: report.website, data: JSON.stringify(report), createdAt: report.generated_at }).run();
    return id;
  }

  get(id: string): ReportV1 | undefined {
    const row = this.db.select().from(reports).where(eq(reports.id, id)).get();
    return row ? ReportV1Schema.parse(JSON.parse(row.data)) : undefined;
  }

  /** The newest report of a run. */
  getByRun(runId: string): { id: string; report: ReportV1 } | undefined {
    const row = this.db.select().from(reports).where(eq(reports.runId, runId)).orderBy(desc(reports.createdAt)).get();
    return row ? { id: row.id, report: ReportV1Schema.parse(JSON.parse(row.data)) } : undefined;
  }
}
