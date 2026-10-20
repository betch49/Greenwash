import { describe, expect, it } from "vitest";
import type { FetchResult, Fetcher } from "@/lib/fetch/fetcher";
import {
  RobotsChecker,
  RobotsDisallowedError,
  RobotsGuardedFetcher,
  RobotsUnavailableError,
  isAllowed,
  parseRobots,
  skippedFromError,
} from "@/lib/fetch/robots";

const ROBOTS = `
# comment
User-agent: *
Disallow: /checkout
Disallow: /private/
Allow: /private/press
Disallow: /*.pdf$

User-agent: BadBot
Disallow: /
`;

class MapFetcher implements Fetcher {
  calls: string[] = [];
  constructor(private files: Record<string, string>) {}
  async get(url: string): Promise<FetchResult> {
    this.calls.push(url);
    const body = this.files[url];
    return {
      url,
      status: body === undefined ? 404 : 200,
      body: body ?? "",
      contentType: "text/plain",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      source: "fixture",
    };
  }
}

describe("robots.txt (1.3)", () => {
  const robots = parseRobots(ROBOTS);

  it("disallows blocked paths and allows others", () => {
    expect(isAllowed(robots, "https://brand.example/checkout/cart")).toBe(false);
    expect(isAllowed(robots, "https://brand.example/private/team")).toBe(false);
    expect(isAllowed(robots, "https://brand.example/sustainability")).toBe(true);
    expect(isAllowed(robots, "https://brand.example/")).toBe(true);
  });

  it("applies longest-match precedence and wildcards", () => {
    expect(isAllowed(robots, "https://brand.example/private/press")).toBe(true);
    expect(isAllowed(robots, "https://brand.example/report.pdf")).toBe(false);
    expect(isAllowed(robots, "https://brand.example/report.pdf?x=1")).toBe(true);
  });

  it("uses the most specific user-agent group", () => {
    expect(isAllowed(robots, "https://brand.example/sustainability", "BadBot/1.0")).toBe(false);
  });

  it("allows everything when robots.txt is missing", async () => {
    const checker = new RobotsChecker(new MapFetcher({}));
    expect(await checker.check("https://nobots.example/anything")).toEqual({ allowed: true });
  });

  it("reports a disallowed fetch as 'skipped: robots.txt disallows <url>' and never fetches it", async () => {
    const inner = new MapFetcher({ "https://brand.example/robots.txt": ROBOTS });
    const guarded = new RobotsGuardedFetcher(inner, new RobotsChecker(inner));
    const url = "https://brand.example/checkout";
    const err = await guarded.get(url).catch((e) => e);
    expect(err).toBeInstanceOf(RobotsDisallowedError);
    expect(skippedFromError(err)).toBe(`skipped: robots.txt disallows ${url}`);
    expect(inner.calls).toEqual(["https://brand.example/robots.txt"]);

    const ok = await guarded.get("https://brand.example/sustainability");
    expect(ok.status).toBe(404); // fetched (not in the map), not blocked
    expect(inner.calls).toHaveLength(2); // robots.txt fetched only once
  });
});

/** Serves one fixed response (or throws) for robots.txt; every other URL is a 200 HTML page. */
class RobotsResponder implements Fetcher {
  calls: string[] = [];
  constructor(private robots: { status: number; body?: string; contentType?: string } | Error) {}
  async get(url: string): Promise<FetchResult> {
    this.calls.push(url);
    const base = { url, fetchedAt: "2026-01-01T00:00:00.000Z", source: "fixture" as const };
    if (!url.endsWith("/robots.txt")) return { ...base, status: 200, body: "<html><body>page</body></html>", contentType: "text/html" };
    if (this.robots instanceof Error) throw this.robots;
    return { ...base, status: this.robots.status, body: this.robots.body ?? "", contentType: this.robots.contentType ?? "text/plain" };
  }
}

describe("robots.txt fails closed (RFC 9309 §2.3.1.3–2.3.1.4, ADR-012)", () => {
  const url = "https://brand.example/sustainability";

  it("5xx ⇒ the whole origin is disallowed, with the reason", async () => {
    const checker = new RobotsChecker(new RobotsResponder({ status: 503 }));
    expect(await checker.check(url)).toEqual({
      allowed: false,
      unavailable: true,
      reason: "robots.txt unavailable for https://brand.example (HTTP 503)",
    });
    expect(await checker.unavailable("https://brand.example")).toBe("robots.txt unavailable for https://brand.example (HTTP 503)");
  });

  it("network error ⇒ disallowed", async () => {
    const checker = new RobotsChecker(new RobotsResponder(new Error("getaddrinfo ENOTFOUND brand.example")));
    expect(await checker.check(url)).toEqual({
      allowed: false,
      unavailable: true,
      reason: "robots.txt unavailable for https://brand.example (getaddrinfo ENOTFOUND brand.example)",
    });
  });

  it("200 with an HTML body (a bot wall, not a robots file) ⇒ disallowed", async () => {
    const wall = "<!DOCTYPE html><html><head><title>Hang Tight!</title></head><body>Routing…</body></html>";
    for (const res of [
      { status: 200, body: wall, contentType: "text/html; charset=utf-8" },
      { status: 200, body: `  ${wall}`, contentType: "text/plain" },
    ]) {
      const checker = new RobotsChecker(new RobotsResponder(res));
      expect(await checker.check(url)).toEqual({
        allowed: false,
        unavailable: true,
        reason: "robots.txt unavailable for https://brand.example (an HTML page, not a robots file)",
      });
    }
  });

  it("404, 410 and other 4xx ⇒ allowed (no restrictions)", async () => {
    for (const status of [401, 403, 404, 410]) {
      const checker = new RobotsChecker(new RobotsResponder({ status }));
      expect(await checker.check(url)).toEqual({ allowed: true });
      expect(await checker.unavailable("https://brand.example")).toBeUndefined();
    }
  });

  it("the guarded fetcher never requests a page on an origin whose robots.txt is unavailable", async () => {
    const inner = new RobotsResponder({ status: 500 });
    const guarded = new RobotsGuardedFetcher(inner, new RobotsChecker(inner));
    const err = await guarded.get(url).catch((e) => e);
    expect(err).toBeInstanceOf(RobotsUnavailableError);
    expect(err).toBeInstanceOf(RobotsDisallowedError);
    expect(skippedFromError(err)).toBe("skipped: robots.txt unavailable for https://brand.example (HTTP 500)");
    expect(inner.calls).toEqual(["https://brand.example/robots.txt"]);
  });
});
