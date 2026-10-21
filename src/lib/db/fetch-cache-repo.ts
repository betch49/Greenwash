import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { fetchCache } from "./schema";

export interface CachedEntry {
  url: string;
  status: number;
  body: string;
  contentType: string;
  fetchedAt: string;
  source: string;
}

export class FetchCacheRepo {
  constructor(private readonly db: Db) {}

  get(url: string): CachedEntry | undefined {
    return this.db.select().from(fetchCache).where(eq(fetchCache.url, url)).get();
  }

  put(entry: CachedEntry): void {
    this.db
      .insert(fetchCache)
      .values(entry)
      .onConflictDoUpdate({
        target: fetchCache.url,
        set: {
          status: entry.status,
          body: entry.body,
          contentType: entry.contentType,
          fetchedAt: entry.fetchedAt,
          source: entry.source,
        },
      })
      .run();
  }
}
