import { describe, expect, it } from "vitest";
import type { FetchResult, Fetcher } from "@/lib/fetch/fetcher";
import { guardedPageFetcher } from "@/lib/pipeline/run";
import { checkLitigation } from "@/lib/pipeline/steps/sabin";
import { isAllowedSabinUrl, sabin } from "@/lib/registries/sabin";
import { OfflineFetcher } from "../helpers/brands";

const NOW = new Date("2026-10-21T12:00:00Z");

/** Logs every URL that reaches the network layer (below the robots guard). */
class LoggingFetcher implements Fetcher {
  readonly log: string[] = [];
  private readonly inner = new OfflineFetcher();
  get(url: string): Promise<FetchResult> {
    this.log.push(url);
    return this.inner.get(url);
  }
}

describe("Sabin adapter requests only /document/ and /geographies/ pages (13.5)", () => {
  it.each([
    ["TotalEnergies", { country: "France" }],
    ["Shell plc", { country: "United Kingdom" }],
    ["Fairphone", { country: "Netherlands" }],
    ["Mammut", { country: "Switzerland" }],
    ["Oatly AB", { country: "Sweden" }],
    ["Northwind Outdoor Ltd.", undefined],
  ] as const)("%s: fetcher log", async (brand, entity) => {
    const f = new LoggingFetcher();
    await checkLitigation(brand, entity, guardedPageFetcher(f).pageFetcher, NOW);
    expect(f.log.length).toBeGreaterThan(1);
    for (const url of f.log) {
      const u = new URL(url);
      expect(u.origin, url).toBe("https://www.climatecasechart.com");
      expect(u.pathname === "/robots.txt" || /^\/(document|geographies)\/[a-z0-9_-]+$/.test(u.pathname), url).toBe(true);
      expect(u.search, url).toBe("");
      expect(url).not.toContain("/_search");
      expect(url).not.toContain("climatepolicyradar.org");
      expect(url).not.toContain("jotform");
    }
  });

  it("the guard refuses anything else before any request", async () => {
    for (const bad of [
      "https://www.climatecasechart.com/_search?q=shell",
      "https://www.climatecasechart.com/search?q=shell",
      "https://app.climatepolicyradar.org/api/v1/searches",
      "https://www.climatecasechart.com/geographies/france?cfn=oil",
      "http://www.climatecasechart.com/document/x",
    ]) {
      expect(isAllowedSabinUrl(bad), bad).toBe(false);
      const f = new LoggingFetcher();
      await expect(sabin.fetchCase(bad, f)).rejects.toThrow(/refusing to request/);
      expect(f.log).toEqual([]);
    }
  });
});
