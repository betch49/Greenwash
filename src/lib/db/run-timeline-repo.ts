import { eq } from "drizzle-orm";
import type { TimelineEntry } from "../wayback/retraction";
import type { Db } from "./client";
import { runTimeline } from "./schema";

/** Stores the archived-claim timeline of a run (one JSON document per run). */
export class RunTimelineRepo {
  constructor(private readonly db: Db) {}

  /** Replaces the timeline stored for a run. */
  replace(runId: string, timeline: TimelineEntry[]): void {
    const data = JSON.stringify(timeline);
    this.db.insert(runTimeline).values({ runId, data }).onConflictDoUpdate({ target: runTimeline.runId, set: { data } }).run();
  }

  list(runId: string): TimelineEntry[] {
    const row = this.db.select().from(runTimeline).where(eq(runTimeline.runId, runId)).get();
    return row ? (JSON.parse(row.data) as TimelineEntry[]) : [];
  }
}
