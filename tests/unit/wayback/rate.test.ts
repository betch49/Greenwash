import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitedFetcher } from "@/lib/fetch/fetcher";
import { buildRateLimiter } from "@/lib/services";
import { MapFetcher } from "../helpers/map-fetcher";

describe("Wayback rate limit (4.3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("spaces requests to web.archive.org ≥ 1000 ms even with WAYBACK_RATE_LIMIT_MS=100", async () => {
    const urls = [
      "https://web.archive.org/cdx/search/cdx?url=a",
      "https://web.archive.org/web/20210101000000id_/https://a.example/",
      "https://web.archive.org/web/20220101000000id_/https://a.example/",
      "https://web.archive.org/web/20230101000000id_/https://a.example/",
    ];
    const inner = new MapFetcher({});
    const times: number[] = [];
    const timed = { get: async (url: string) => (times.push(Date.now()), inner.get(url)) };
    const fetcher = new RateLimitedFetcher(timed, buildRateLimiter({ WAYBACK_RATE_LIMIT_MS: "100", GR_RATE_LIMIT_MS: "100" }));

    const all = Promise.all(urls.map((u) => fetcher.get(u)));
    await vi.runAllTimersAsync();
    await all;

    expect(times).toHaveLength(4);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(1000);
  });

  it("other hosts follow GR_RATE_LIMIT_MS (here 100 ms)", async () => {
    const times: number[] = [];
    const inner = new MapFetcher({});
    const timed = { get: async (url: string) => (times.push(Date.now()), inner.get(url)) };
    const fetcher = new RateLimitedFetcher(timed, buildRateLimiter({ WAYBACK_RATE_LIMIT_MS: "100", GR_RATE_LIMIT_MS: "100" }));
    const all = Promise.all(["https://a.example/1", "https://a.example/2"].map((u) => fetcher.get(u)));
    await vi.runAllTimersAsync();
    await all;
    expect(times[1] - times[0]).toBe(100);
  });
});
