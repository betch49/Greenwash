import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FetchCacheRepo } from "@/lib/db/fetch-cache-repo";
import { CachedFetcher, type FetchResult, type Fetcher } from "@/lib/fetch/fetcher";
import { tempDb } from "../helpers/db";

class CountingFetcher implements Fetcher {
  calls = 0;
  constructor(private status = 200) {}
  async get(url: string): Promise<FetchResult> {
    this.calls++;
    return {
      url,
      status: this.status,
      body: `body #${this.calls}`,
      contentType: "text/html",
      fetchedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, this.calls)).toISOString(),
      source: "network",
    };
  }
}

describe("CachedFetcher (1.1)", () => {
  let env: ReturnType<typeof tempDb>;
  beforeEach(() => {
    env = tempDb();
  });
  afterEach(() => env.cleanup());

  it("serves the second request from SQLite and keeps the original fetched_at", async () => {
    const inner = new CountingFetcher();
    const cached = new CachedFetcher(inner, new FetchCacheRepo(env.db));
    const a = await cached.get("https://example.com/a");
    const b = await cached.get("https://example.com/a");
    expect(inner.calls).toBe(1);
    expect(b.fetchedAt).toBe(a.fetchedAt);
    expect(b.body).toBe(a.body);
    expect(a.source).toBe("network");
    expect(b.source).toBe("cache");
  });

  it("survives a new CachedFetcher instance on the same database", async () => {
    const inner = new CountingFetcher();
    const repo = new FetchCacheRepo(env.db);
    const first = await new CachedFetcher(inner, repo).get("https://example.com/b");
    const second = await new CachedFetcher(inner, repo).get("https://example.com/b");
    expect(inner.calls).toBe(1);
    expect(second.fetchedAt).toBe(first.fetchedAt);
  });

  it("refetches once the TTL has expired", async () => {
    const inner = new CountingFetcher();
    let now = new Date("2026-01-01T00:00:00Z");
    const cached = new CachedFetcher(inner, new FetchCacheRepo(env.db), 60_000, () => now);
    await cached.get("https://example.com/c");
    now = new Date("2026-01-01T00:10:00Z");
    await cached.get("https://example.com/c");
    expect(inner.calls).toBe(2);
  });

  it("does not cache transient failures (5xx)", async () => {
    const inner = new CountingFetcher(503);
    const cached = new CachedFetcher(inner, new FetchCacheRepo(env.db));
    await cached.get("https://example.com/d");
    await cached.get("https://example.com/d");
    expect(inner.calls).toBe(2);
  });
});
