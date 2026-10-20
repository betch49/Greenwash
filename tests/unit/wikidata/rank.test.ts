import { describe, expect, it } from "vitest";
import type { FetchResult, Fetcher } from "@/lib/fetch/fetcher";
import { FixtureFetcher, combineMaps } from "@/lib/fetch/fixture-fetcher";
import { wikidataFixturePath } from "@/lib/wikidata/fixtures";
import { disambiguate } from "@/lib/wikidata/disambiguate";
import { WikidataError } from "@/lib/wikidata/api";

/** Recorded fixtures only; any URL without a fixture fails the test (no network). */
class StrictFixtures implements Fetcher {
  private inner = new FixtureFetcher("fixtures", combineMaps(wikidataFixturePath));
  async get(url: string): Promise<FetchResult> {
    const res = await this.inner.get(url);
    if (res.status !== 200) throw new Error(`no fixture for ${url}`);
    return res;
  }
}

const fixtures = new StrictFixtures();

describe("Wikidata ranking on recorded fixtures (1.5)", () => {
  it("'patagonia' ⇒ confident single match with website", async () => {
    const r = await disambiguate(fixtures, "patagonia");
    expect(r.confident).not.toBeNull();
    expect(r.confident).toMatchObject({
      id: "Q1660552",
      name: "Patagonia, Inc.",
      websiteHost: "patagonia.com",
      country: "United States",
      exactName: true,
    });
    expect(r.candidates).toHaveLength(1);
  });

  it("'acme' ⇒ no confident match (and no company candidates: URL fallback)", async () => {
    const r = await disambiguate(fixtures, "acme");
    expect(r.confident).toBeNull();
    expect(r.candidates).toEqual([]);
  });

  it("'continental' (two plausible companies) ⇒ ≤ 3 candidates, none confident", async () => {
    const r = await disambiguate(fixtures, "continental");
    expect(r.confident).toBeNull();
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.candidates.length).toBeLessThanOrEqual(3);
    expect(r.candidates.map((c) => c.name)).toEqual(expect.arrayContaining(["Continental AG", "United Airlines"]));
    for (const c of r.candidates) expect(c.website).toMatch(/^https?:\/\//);
  });

  it.each([
    ["fairphone", "Q5019402", "fairphone.com"],
    ["oatly", "Q10605824", "oatly.com"],
  ])("fixture brand '%s' ⇒ confident %s (%s)", async (q, id, host) => {
    const r = await disambiguate(fixtures, q);
    expect(r.confident?.id).toBe(id);
    expect(r.confident?.websiteHost).toBe(host);
  });

  it("an empty query returns nothing without fetching", async () => {
    expect(await disambiguate(fixtures, "   ")).toEqual({ confident: null, candidates: [] });
  });

  it("a Wikidata error payload (search too busy) raises WikidataError", async () => {
    const busy: Fetcher = {
      async get(url) {
        return {
          url,
          status: 200,
          body: JSON.stringify({ error: { code: "cirrussearch-too-busy-error", info: "busy" } }),
          contentType: "application/json",
          fetchedAt: new Date().toISOString(),
          source: "fixture",
        };
      },
    };
    await expect(disambiguate(busy, "patagonia")).rejects.toBeInstanceOf(WikidataError);
  });
});
