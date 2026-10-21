import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { ReportV1Schema, type ReportV1 } from "../score/report";
import type { Db } from "./client";
import { reports, runs } from "./schema";

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

  /**
   * The newest report for the same brand identity generated at or after
   * `notBefore` (ISO), for re-serving (PLAN Phase 8 deliverable 2). Same identity =
   * one of `websites` (equivalent spellings of one site) and the same Wikidata
   * entity; without an entity (URL fallback), the same brand name (case-insensitive),
   * so a report made under another name or entity is never served for this search.
   */
  findFresh(websites: string | string[], notBefore: string, who: { wikidataId?: string | null; brand?: string } = {}): { id: string; createdAt: string } | undefined {
    const list = Array.isArray(websites) ? websites : [websites];
    const identity = who.wikidataId
      ? eq(runs.wikidataId, who.wikidataId)
      : and(isNull(runs.wikidataId), sql`lower(${reports.brand}) = lower(${who.brand ?? ""})`);
    const row = this.db
      .select({ id: reports.id, createdAt: reports.createdAt })
      .from(reports)
      .innerJoin(runs, eq(runs.id, reports.runId))
      .where(and(inArray(reports.website, list), gte(reports.createdAt, notBefore), identity))
      .orderBy(desc(reports.createdAt))
      .get();
    return row ?? undefined;
  }

  /** The stored JSON of a report exactly as saved (the export serves it without re-encoding). */
  getRaw(id: string): string | undefined {
    return this.db.select({ data: reports.data }).from(reports).where(eq(reports.id, id)).get()?.data;
  }
}
