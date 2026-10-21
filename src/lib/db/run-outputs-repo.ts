import { eq } from "drizzle-orm";
import type { TimelineEntry } from "../wayback/retraction";
import type { Db } from "./client";
import { runOutputs } from "./schema";

/** What a finished run produced besides pages and progress, until ReportV1 (Phase 6) stores it. */
export interface RunOutputs {
  timeline: TimelineEntry[];
  could_not_check: string[];
}

export class RunOutputsRepo {
  constructor(private readonly db: Db) {}

  /** Replaces the outputs stored for a run. */
  replace(runId: string, out: RunOutputs): void {
    const values = { timeline: JSON.stringify(out.timeline), couldNotCheck: JSON.stringify(out.could_not_check) };
    this.db
      .insert(runOutputs)
      .values({ runId, ...values })
      .onConflictDoUpdate({ target: runOutputs.runId, set: values })
      .run();
  }

  get(runId: string): RunOutputs {
    const row = this.db.select().from(runOutputs).where(eq(runOutputs.runId, runId)).get();
    return row
      ? { timeline: JSON.parse(row.timeline) as TimelineEntry[], could_not_check: JSON.parse(row.couldNotCheck) as string[] }
      : { timeline: [], could_not_check: [] };
  }
}
