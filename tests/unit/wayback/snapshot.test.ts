import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FetchCacheRepo } from "@/lib/db/fetch-cache-repo";
import { CachedFetcher } from "@/lib/fetch/fetcher";
import type { CdxSnapshot } from "@/lib/wayback/cdx";
import { fetchSnapshot, isSnapshotUrl, parseSnapshotUrl, snapshotUrl, waybackAwareTtl } from "@/lib/wayback/snapshot";
import { tempDb } from "../helpers/db";
import { MapFetcher } from "../helpers/map-fetcher";

const PAGE = "https://www.northwind-outdoor.example/our-footprint/";
const SNAP: CdxSnapshot = { timestamp: "20210315141503", original: PAGE, statuscode: "200", mimetype: "text/html", year: 2021, date: "2021-03-15" };
const ID_URL = "https://web.archive.org/web/20210315141503id_/https://www.northwind-outdoor.example/our-footprint/";
const HTML =
  "<html><head><title>Our Footprint</title></head><body><nav>MENU SENTINEL</nav><main><p>We are carbon neutral.</p></main><footer>FOOT SENTINEL</footer></body></html>";

describe("snapshots (4.2)", () => {
  let env: ReturnType<typeof tempDb>;
  beforeEach(() => {
    env = tempDb();
  });
  afterEach(() => env.cleanup());

  it("uses the id_ flag URL", () => {
    expect(snapshotUrl(SNAP.timestamp, SNAP.original)).toBe(ID_URL);
    expect(parseSnapshotUrl(ID_URL)).toEqual({ timestamp: "20210315141503", original: PAGE });
    expect(isSnapshotUrl("https://web.archive.org/cdx/search/cdx?url=x")).toBe(false);
    expect(isSnapshotUrl("https://web.archive.org/web/20210315141503/https://x.example/")).toBe(false); // no id_: toolbar version
  });

  it("fetches through the cache: two runs hit the inner fetcher once, and snapshots never expire", async () => {
    const inner = new MapFetcher({ [ID_URL]: HTML });
    let now = new Date("2026-10-20T00:00:00Z");
    const weekMs = 7 * 24 * 3600 * 1000;
    const cached = new CachedFetcher(inner, new FetchCacheRepo(env.db), waybackAwareTtl(weekMs), () => now);

    const first = await fetchSnapshot(PAGE, SNAP, cached);
    now = new Date("2036-10-20T00:00:00Z"); // ten years later: still served from the cache
    const second = await fetchSnapshot(PAGE, SNAP, cached);

    expect(inner.calls).toEqual([ID_URL]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.snapshot.fetchedAt).toBe(first.snapshot.fetchedAt);
    expect(first.snapshot).toMatchObject({ pageUrl: PAGE, snapshotUrl: ID_URL, year: 2021, date: "2021-03-15", title: "Our Footprint" });
    // Visible text only, nav/footer stripped (brief Section 5).
    expect(first.snapshot.text).toBe("We are carbon neutral.");
  });

  it("other URLs keep the default TTL", () => {
    const ttl = waybackAwareTtl(1000);
    expect(ttl(ID_URL)).toBe(Infinity);
    expect(ttl("https://web.archive.org/cdx/search/cdx?url=x")).toBe(1000);
    expect(ttl(PAGE)).toBe(1000);
  });

  it("a 404 snapshot is returned as not ok (listed as skipped by the step); 429 throws", async () => {
    expect(await fetchSnapshot(PAGE, SNAP, new MapFetcher({}))).toEqual({ ok: false, url: ID_URL, status: 404 });
    const limited = { get: async (url: string) => ({ url, status: 429, body: "", contentType: "", fetchedAt: "2026-01-01T00:00:00Z", source: "network" as const }) };
    await expect(fetchSnapshot(PAGE, SNAP, limited)).rejects.toThrow("Wayback unreachable (HTTP 429)");
  });
});
