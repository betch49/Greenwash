import { describe, expect, it } from "vitest";
import { FixtureFetcher, combineMaps } from "@/lib/fetch/fixture-fetcher";
import { wikidataFixturePath } from "@/lib/wikidata/fixtures";
import { searchUrl } from "@/lib/wikidata/api";

describe("FixtureFetcher", () => {
  const fetcher = new FixtureFetcher("fixtures", combineMaps(wikidataFixturePath));

  it("resolves a Wikidata search URL to its recorded fixture", async () => {
    const res = await fetcher.get(searchUrl("patagonia", 7));
    expect(res.status).toBe(200);
    expect(res.source).toBe("fixture");
    expect(JSON.parse(res.body).search.length).toBeGreaterThan(0);
  });

  it("returns 404 for unknown URLs and never escapes the fixture root", async () => {
    expect((await fetcher.get("https://unknown.example/")).status).toBe(404);
    const escaping = new FixtureFetcher("fixtures", () => "../package.json");
    expect((await escaping.get("https://x.example/")).status).toBe(404);
  });
});
