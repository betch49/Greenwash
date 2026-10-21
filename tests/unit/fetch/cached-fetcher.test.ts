import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FetchCacheRepo } from "@/lib/db/fetch-cache-repo";
import { CachedFetcher, type FetchResult, type Fetcher } from "@/lib/fetch/fetcher";
import { RobotsChecker } from "@/lib/fetch/robots";
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

class FailingFetcher implements Fetcher {
  calls = 0;
  constructor(private readonly mode: "throw" | 503 | 404) {}
  async get(url: string): Promise<FetchResult> {
    this.calls++;
    if (this.mode === "throw") throw new Error("connect ECONNREFUSED");
    return { url, status: this.mode, body: "down", contentType: "text/plain", fetchedAt: "2026-02-01T00:00:00.000Z", source: "network" };
  }
}

describe("CachedFetcher: stale robots.txt on a failed live fetch (ADR-012 amendment, Phase 8)", () => {
  let env: ReturnType<typeof tempDb>;
  beforeEach(() => {
    env = tempDb();
  });
  afterEach(() => env.cleanup());

  const seed = (repo: FetchCacheRepo, url: string) =>
    repo.put({ url, status: 200, body: "User-agent: *\nDisallow: /private/\n", contentType: "text/plain", fetchedAt: "2026-01-01T00:00:00.000Z", source: "network" });
  const later = () => new Date("2026-03-01T00:00:00Z");

  it.each(["throw", 503] as const)("serves the expired cached robots.txt with its original fetched_at when the live fetch fails (%s)", async (mode) => {
    const repo = new FetchCacheRepo(env.db);
    seed(repo, "https://example.com/robots.txt");
    const inner = new FailingFetcher(mode);
    const res = await new CachedFetcher(inner, repo, 60_000, later).get("https://example.com/robots.txt");
    expect(inner.calls).toBe(1);
    expect(res.source).toBe("cache");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Disallow: /private/");
    expect(res.fetchedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("a definitive live answer (404) replaces the stale robots.txt", async () => {
    const repo = new FetchCacheRepo(env.db);
    seed(repo, "https://example.com/robots.txt");
    const res = await new CachedFetcher(new FailingFetcher(404), repo, 60_000, later).get("https://example.com/robots.txt");
    expect(res.status).toBe(404);
    expect(res.source).toBe("network");
  });

  it("never serves a stale page other than robots.txt: the failure surfaces", async () => {
    const repo = new FetchCacheRepo(env.db);
    seed(repo, "https://example.com/sustainability");
    await expect(new CachedFetcher(new FailingFetcher("throw"), repo, 60_000, later).get("https://example.com/sustainability")).rejects.toThrow("ECONNREFUSED");
    const res = await new CachedFetcher(new FailingFetcher(503), repo, 60_000, later).get("https://example.com/sustainability");
    expect(res.status).toBe(503);
  });

  it("RobotsChecker over the cache: the origin keeps its last robots rules instead of being skipped", async () => {
    const repo = new FetchCacheRepo(env.db);
    seed(repo, "https://example.com/robots.txt");
    const checker = new RobotsChecker(new CachedFetcher(new FailingFetcher(503), repo, 60_000, later));
    expect(await checker.unavailable("https://example.com")).toBeUndefined();
    expect(await checker.check("https://example.com/sustainability")).toEqual({ allowed: true });
    expect((await checker.check("https://example.com/private/x")).allowed).toBe(false);
  });

  it("no cached robots.txt ⇒ the failure surfaces (the origin is then skipped, ADR-012)", async () => {
    await expect(new CachedFetcher(new FailingFetcher("throw"), new FetchCacheRepo(env.db), 60_000, later).get("https://example.com/robots.txt")).rejects.toThrow();
  });
});
