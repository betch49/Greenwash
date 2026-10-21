import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@/lib/db/client";
import { FetchCacheRepo } from "@/lib/db/fetch-cache-repo";
import { CachedFetcher, type FetchOptions, type FetchResult, type Fetcher } from "@/lib/fetch/fetcher";
import { tempDb } from "../helpers/db";
import { sbtiFixture } from "../helpers/sbti";

class BinaryFetcher implements Fetcher {
  calls = 0;
  constructor(private readonly bytes: Buffer) {}
  async get(url: string, opts?: FetchOptions): Promise<FetchResult> {
    this.calls++;
    return {
      url,
      status: 200,
      body: opts?.binary ? "" : this.bytes.toString("latin1"),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fetchedAt: "2026-10-21T07:41:00.000Z",
      source: "network",
      ...(opts?.binary ? { bytes: this.bytes } : {}),
    };
  }
}

describe("binary bodies through CachedFetcher (11.6)", () => {
  let env: ReturnType<typeof tempDb>;
  beforeEach(() => {
    env = tempDb();
  });
  afterEach(() => env.cleanup());

  it("the second fetch is served from SQLite with identical bytes", async () => {
    const bytes = sbtiFixture().bytes;
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    const inner = new BinaryFetcher(bytes);
    const cached = new CachedFetcher(inner, new FetchCacheRepo(env.db));
    const a = await cached.get("https://files.example/export.xlsx", { binary: true });
    const b = await cached.get("https://files.example/export.xlsx", { binary: true });
    expect(inner.calls).toBe(1);
    expect(a.source).toBe("network");
    expect(b.source).toBe("cache");
    expect(b.fetchedAt).toBe(a.fetchedAt);
    expect(Buffer.compare(b.bytes!, bytes)).toBe(0);
    expect(b.body).toBe("");
    // Bytes that are not valid UTF-8 survive too.
    const odd = Buffer.from([0, 255, 254, 128, 10, 13, 0xc3]);
    const c2 = new CachedFetcher(new BinaryFetcher(odd), new FetchCacheRepo(env.db));
    await c2.get("https://files.example/odd.bin", { binary: true });
    expect(Buffer.compare((await c2.get("https://files.example/odd.bin", { binary: true })).bytes!, odd)).toBe(0);
  });

  it("text entries are unchanged (encoding utf8, no bytes)", async () => {
    const repo = new FetchCacheRepo(env.db);
    repo.put({ url: "https://x.example/", status: 200, body: "hello", contentType: "text/html", fetchedAt: "2026-10-21T00:00:00.000Z", source: "network" });
    const res = await new CachedFetcher(new BinaryFetcher(Buffer.from("")), repo).get("https://x.example/");
    expect(res.body).toBe("hello");
    expect(res.bytes).toBeUndefined();
  });

  it("an older database without the encoding column is migrated on open", () => {
    const dir = mkdtempSync(join(tmpdir(), "gr-old-"));
    const path = join(dir, "old.db");
    const old = new Database(path);
    old.exec("CREATE TABLE fetch_cache (url TEXT PRIMARY KEY, status INTEGER NOT NULL, body TEXT NOT NULL, content_type TEXT NOT NULL DEFAULT '', fetched_at TEXT NOT NULL, source TEXT NOT NULL)");
    old.exec("INSERT INTO fetch_cache VALUES ('https://x.example/', 200, 'old', 'text/html', '2026-01-01T00:00:00.000Z', 'network')");
    old.close();
    const db = openDb(path);
    expect(new FetchCacheRepo(db).get("https://x.example/")).toMatchObject({ body: "old", encoding: "utf8" });
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
