import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";
import { FetchError, UndiciFetcher, parseRetryAfter } from "@/lib/fetch/fetcher";

describe("UndiciFetcher retry (1.2)", () => {
  let agent: MockAgent;
  let sleeps: number[];
  const make = () =>
    new UndiciFetcher({
      dispatcher: agent,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
    sleeps = [];
  });
  afterEach(async () => {
    await agent.close();
  });

  it("honours Retry-After on 429, then succeeds with one retry", async () => {
    const pool = agent.get("https://api.example.org");
    pool.intercept({ path: "/x", method: "GET" }).reply(429, "slow down", { headers: { "retry-after": "7" } });
    pool.intercept({ path: "/x", method: "GET" }).reply(200, "ok", { headers: { "content-type": "text/plain" } });
    const res = await make().get("https://api.example.org/x");
    expect(res.status).toBe(200);
    expect(res.body).toBe("ok");
    expect(sleeps).toEqual([7000]);
  });

  it("gives up after 3 tries and throws FetchError with status 429", async () => {
    const pool = agent.get("https://api.example.org");
    for (let i = 0; i < 4; i++) {
      pool.intercept({ path: "/y", method: "GET" }).reply(429, "no", { headers: { "retry-after": "1" } });
    }
    const err = await make()
      .get("https://api.example.org/y")
      .catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).status).toBe(429);
    expect(sleeps).toHaveLength(2); // 3 tries ⇒ 2 waits
    // the 4th interceptor was never consumed
    expect(agent.pendingInterceptors()).toHaveLength(1);
  });

  it("sends a descriptive User-Agent", async () => {
    const pool = agent.get("https://api.example.org");
    let ua = "";
    pool.intercept({ path: "/ua", method: "GET" }).reply(200, (opts) => {
      const h = opts.headers as Record<string, string>;
      ua = h["user-agent"] ?? "";
      return "ok";
    });
    await make().get("https://api.example.org/ua");
    expect(ua).toMatch(/GreenwashRadar\/\d/);
  });

  it("returns non-retryable statuses (404) without retrying", async () => {
    agent.get("https://api.example.org").intercept({ path: "/z", method: "GET" }).reply(404, "nope");
    const res = await make().get("https://api.example.org/z");
    expect(res.status).toBe(404);
    expect(sleeps).toHaveLength(0);
  });

  it("parses Retry-After as seconds or HTTP date", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("53", now)).toBe(53_000);
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:10 GMT", now)).toBe(10_000);
    expect(parseRetryAfter(undefined, now)).toBeUndefined();
  });
});
