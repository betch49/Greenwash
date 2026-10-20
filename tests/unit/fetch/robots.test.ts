import { describe, expect, it } from "vitest";
import type { FetchResult, Fetcher } from "@/lib/fetch/fetcher";
import {
  RobotsChecker,
  RobotsDisallowedError,
  RobotsGuardedFetcher,
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
