// Criterion 12.1: recorded data.gouv.fr API pages parse into datasets; pagination follows
// next_page up to maxPages. Plus the ADR-011 guard on the fr-repair fixtures and the cache TTL.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { FR_INDEX, frApiFirstPage, frRepairAwareTtl, isFrRepairUrl, listDatasets, parseDatasetsPage, FrParseError } from "@/lib/registries/fr-repair";
import { FR_DIR, LogFetcher, frManifest, frSource } from "./fr-helpers";

const PAGE1 = frApiFirstPage();
const PAGE2 = "https://www.data.gouv.fr/api/1/datasets/?q=indice+de+reparabilite&page_size=100&page=2";

describe("data.gouv.fr dataset API (12.1)", () => {
  it("the first page URL is the plan's query with page_size from config", () => {
    expect(PAGE1).toBe("https://www.data.gouv.fr/api/1/datasets/?q=indice%20de%20reparabilite&page_size=100");
  });

  it("a recorded page parses into datasets with slug, publisher, licence and resources", () => {
    const page = parseDatasetsPage(frSource(PAGE1), PAGE1);
    expect(page.datasets).toHaveLength(100);
    expect(page.total).toBe(125);
    expect(page.next_page).toBe(PAGE2);
    const fp = page.datasets.find((d) => d.publisher === "Fairphone")!;
    expect(fp).toMatchObject({
      slug: "indice-de-reparabilite-organisation-fairphone-1",
      page: "https://www.data.gouv.fr/datasets/indice-de-reparabilite-organisation-fairphone-1",
      license: "lov2",
      title: "Indice de réparabilité (organisation Fairphone)",
    });
    expect(fp.resources).toEqual([expect.objectContaining({ id: "5207fe39-1c14-4a40-8301-c84dc9b9a839", format: "csv", url: expect.stringMatching(/^https:\/\/static\.data\.gouv\.fr\/resources\//) })]);
    const elx = page.datasets.find((d) => d.publisher === "ELECTROLUX FRANCE")!;
    expect(elx.license).toBe("notspecified");
    // A dataset published by a person: the owner's name is the publisher.
    expect(page.datasets.find((d) => d.title === "Nilfisk - Indice de réparabilité")?.publisher).toBe("Gaëtan Bouvret");
    const licences = new Set(page.datasets.map((d) => d.license));
    expect(licences).toEqual(new Set(["notspecified", "lov2", "other-pd"]));
  });

  it("follows next_page to the last page, de-duplicating by id", async () => {
    const f = new LogFetcher({ [PAGE1]: frSource(PAGE1), [PAGE2]: frSource(PAGE2) });
    const { datasets, pages } = await listDatasets(f);
    expect(pages).toEqual([PAGE1, PAGE2]);
    expect(f.calls).toEqual([PAGE1, PAGE2]);
    // The API's pages overlap: 125 results reported, 115 distinct ids on the two pages.
    expect(datasets).toHaveLength(115);
    expect(new Set(datasets.map((d) => d.id)).size).toBe(115);
  });

  it("stops at maxPages", async () => {
    const f = new LogFetcher({ [PAGE1]: frSource(PAGE1), [PAGE2]: frSource(PAGE2) });
    const { datasets, pages } = await listDatasets(f, { ...FR_INDEX, maxPages: 1 });
    expect(pages).toEqual([PAGE1]);
    expect(f.calls).toEqual([PAGE1]);
    expect(datasets).toHaveLength(100);
  });

  it("a body that is not a dataset list ⇒ FrParseError with the plan's reason", () => {
    expect(() => parseDatasetsPage("<html>maintenance</html>", PAGE1)).toThrow(FrParseError);
    expect(() => parseDatasetsPage(JSON.stringify({ message: "x" }), PAGE1)).toThrow(`repairability dataset could not be parsed (${PAGE1})`);
  });

  it("the cache applies frIndex.ttlHours to the data.gouv.fr URLs only", () => {
    const ttl = frRepairAwareTtl(() => 7);
    expect(ttl(PAGE1)).toBe(FR_INDEX.ttlHours * 3_600_000);
    expect(ttl("https://tabular-api.data.gouv.fr/api/resources/x/data/csv/")).toBe(FR_INDEX.ttlHours * 3_600_000);
    expect(ttl("https://www.fairphone.com/")).toBe(7);
    expect(isFrRepairUrl("https://www.data.gouv.fr/robots.txt")).toBe(false);
  });
});

describe("fr-repair fixtures are real captures (ADR-011)", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));

  it("every file is listed in the manifest, from data.gouv.fr hosts, with a capture date; trimmed pages record the original hash", () => {
    const m = frManifest();
    const listed = new Set(Object.values(m.files).map((f) => f.file));
    for (const [url, e] of Object.entries(m.files)) {
      expect(existsSync(join(FR_DIR, e.file)), e.file).toBe(true);
      expect(Number.isNaN(Date.parse(e.capturedAt)), url).toBe(false);
      expect(["www.data.gouv.fr", "static.data.gouv.fr", "tabular-api.data.gouv.fr"]).toContain(new URL(url).host);
      if (e.file.startsWith("api/")) {
        expect(e.original?.sha256, url).toMatch(/^[0-9a-f]{64}$/);
        expect(readFileSync(join(FR_DIR, e.file), "utf8")).toContain("Trimmed real capture");
      } else {
        expect(e.original).toBeUndefined();
      }
    }
    for (const f of files(FR_DIR)) {
      const rel = relative(FR_DIR, f).split("\\").join("/");
      if (rel === "manifest.json" || rel === "README.md") continue;
      expect(listed.has(rel), `${rel} is not in the manifest`).toBe(true);
    }
    // Only one CSV was ever fetched: the openly licensed Fairphone dataset (the gated ones never are).
    expect(Object.keys(m.files).filter((u) => u.includes("/data/csv/") || u.endsWith(".csv"))).toHaveLength(1);
  });
});
