import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "@/lib/fetch/rate-limiter";

describe("RateLimiter (1.4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("spaces calls to the same host by at least perHostMs", async () => {
    const limiter = new RateLimiter(1000);
    const times: number[] = [];
    const calls = [0, 1, 2, 3].map(() => limiter.wait("https://a.example/x").then(() => times.push(Date.now())));
    await vi.runAllTimersAsync();
    await Promise.all(calls);
    expect(times).toHaveLength(4);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(1000);
  });

  it("does not delay calls to different hosts", async () => {
    const limiter = new RateLimiter(1000);
    const start = Date.now();
    const times: number[] = [];
    const calls = ["https://a.example/", "https://b.example/", "https://c.example/"].map((u) =>
      limiter.wait(u).then(() => times.push(Date.now() - start)),
    );
    await vi.runAllTimersAsync();
    await Promise.all(calls);
    expect(times).toEqual([0, 0, 0]);
  });

  it("enforces per-host minimums above perHostMs", async () => {
    const limiter = new RateLimiter(100, { hostMinimums: { "web.archive.org": 1000 } });
    expect(limiter.intervalFor("web.archive.org")).toBe(1000);
    expect(limiter.intervalFor("example.com")).toBe(100);
    const times: number[] = [];
    const calls = [0, 1].map(() => limiter.wait("https://web.archive.org/cdx").then(() => times.push(Date.now())));
    await vi.runAllTimersAsync();
    await Promise.all(calls);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000);
  });

  it("does not wait when calls are already spaced", async () => {
    const limiter = new RateLimiter(1000);
    await limiter.wait("https://a.example/");
    vi.advanceTimersByTime(1500);
    const before = Date.now();
    await limiter.wait("https://a.example/");
    expect(Date.now()).toBe(before);
  });
});
