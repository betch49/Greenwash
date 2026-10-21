import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import type { Db } from "./client";
import { runs } from "./schema";

export interface ProgressEntry {
  step: string;
  status: "running" | "done" | "skipped";
  reason?: string;
}

export type RunStatus = "pending" | "running" | "done" | "failed";

export interface NewRun {
  query: string;
  brand: string;
  website: string;
  wikidataId?: string | null;
  entity?: unknown;
}

export interface Run {
  id: string;
  query: string;
  brand: string;
  website: string;
  wikidataId: string | null;
  entity: unknown;
  status: string;
  progress: ProgressEntry[];
  createdAt: string;
}

export class RunsRepo {
  constructor(private readonly db: Db) {}

  create(input: NewRun): Run {
    const row = {
      id: randomUUID(),
      query: input.query,
      brand: input.brand,
      website: input.website,
      wikidataId: input.wikidataId ?? null,
      entityJson: input.entity === undefined ? null : JSON.stringify(input.entity),
      status: "pending",
      progress: "[]",
      createdAt: new Date().toISOString(),
    };
    this.db.insert(runs).values(row).run();
    return this.toRun(row);
  }

  get(id: string): Run | undefined {
    const row = this.db.select().from(runs).where(eq(runs.id, id)).get();
    return row ? this.toRun(row) : undefined;
  }

  /**
   * Atomically moves a run from "pending" to "running". Returns true for exactly
   * one caller per run, so starting the pipeline is idempotent (a refresh, a
   * double submit or React strict mode never starts it twice).
   */
  claimStart(id: string): boolean {
    const res = this.db
      .update(runs)
      .set({ status: "running" })
      .where(and(eq(runs.id, id), eq(runs.status, "pending")))
      .run();
    return res.changes === 1;
  }

  setProgress(id: string, progress: ProgressEntry[]): void {
    this.db.update(runs).set({ progress: JSON.stringify(progress) }).where(eq(runs.id, id)).run();
  }

  setStatus(id: string, status: RunStatus): void {
    this.db.update(runs).set({ status }).where(eq(runs.id, id)).run();
  }

  count(): number {
    return this.db.select({ n: count() }).from(runs).get()?.n ?? 0;
  }

  private toRun(row: typeof runs.$inferSelect): Run {
    return {
      id: row.id,
      query: row.query,
      brand: row.brand,
      website: row.website,
      wikidataId: row.wikidataId,
      entity: row.entityJson ? JSON.parse(row.entityJson) : null,
      status: row.status,
      progress: JSON.parse(row.progress) as ProgressEntry[],
      createdAt: row.createdAt,
    };
  }
}
