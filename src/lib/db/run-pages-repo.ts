import { asc, eq } from "drizzle-orm";
import type { FetchedPage } from "../discover/fetch-pages";
import type { CandidateVia } from "../discover/heuristics";
import type { FetchSource } from "../fetch/fetcher";
import type { Db } from "./client";
import { runPages } from "./schema";

export class RunPagesRepo {
  constructor(private readonly db: Db) {}

  /** Replaces the pages stored for a run (a re-run never mixes old and new pages). */
  replace(runId: string, pages: FetchedPage[]): void {
    this.db.transaction((tx) => {
      tx.delete(runPages).where(eq(runPages.runId, runId)).run();
      pages.forEach((p, position) => {
        tx.insert(runPages)
          .values({
            runId,
            position,
            url: p.url,
            via: p.via,
            title: p.title,
            text: p.text,
            wordCount: p.wordCount,
            linksJson: JSON.stringify(p.links),
            fetchedAt: p.fetchedAt,
            source: p.source,
            contentHash: p.contentHash,
          })
          .run();
      });
    });
  }

  list(runId: string): FetchedPage[] {
    return this.db
      .select()
      .from(runPages)
      .where(eq(runPages.runId, runId))
      .orderBy(asc(runPages.position))
      .all()
      .map((r) => ({
        url: r.url,
        via: r.via as CandidateVia,
        title: r.title,
        text: r.text,
        wordCount: r.wordCount,
        links: JSON.parse(r.linksJson),
        fetchedAt: r.fetchedAt,
        source: r.source as FetchSource,
        contentHash: r.contentHash,
      }));
  }
}
