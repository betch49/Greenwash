import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { guardedPageFetcher } from "@/lib/pipeline/run";
import { receiptProblem } from "@/lib/pipeline/signal";
import { checkLitigation } from "@/lib/pipeline/steps/sabin";
import { SEED_INDEX } from "@/lib/registries/sabin";
import { findForbidden } from "@/lib/copy/forbidden";
import { MapFetcher } from "../helpers/map-fetcher";
import { OfflineFetcher } from "../helpers/brands";
import { DOC, GEO, SABIN_DIR, sabinManifest, sabinPage, synthetic } from "./sabin-helpers";

const NOW = new Date("2026-10-21T12:00:00Z");
const offline = () => guardedPageFetcher(new OfflineFetcher()).pageFetcher;
const COVERAGE = /^Climate litigation coverage: only the newest cases listed for .+ and a recorded index of \d+ cases?; the database’s search is not available to automated clients/;

describe("Sabin fixtures: real recorded cases (13.3, 13.7)", () => {
  it("TotalEnergies (real ground-truth candidate, France): one scored litigation.case with receipt, party verbatim, “a filed case is not a ruling”", async () => {
    const r = await checkLitigation("TotalEnergies", { country: "France" }, offline(), NOW);
    expect(r.signals).toHaveLength(1);
    const s = r.signals[0];
    expect(receiptProblem(s)).toBeNull();
    expect(s).toMatchObject({ axis: "track", kind: "litigation.case", source_url: DOC.total, entity_name: "TotalEnergies SE", llm_used: false });
    expect(s.fetched_at).toBe(sabinPage(DOC.total).capturedAt);
    expect(s.label).toBe("Case found naming TotalEnergies SE (Decided, filed 2022) — a filed case is not a ruling");
    expect(s.excerpt.startsWith("Greenpeace France and Others v. TotalEnergies SE and TotalEnergies Electricité et Gaz France. On March 2, 2022")).toBe(true);
    expect(s.excerpt).toContain("Status as published: Decided; last event as published: Decision (2025-10-23).");
    expect(s.excerpt).toContain(`Source: Sabin Center for Climate Change Law, Climate Litigation Database, ${DOC.total}`);
    // Decided ⇒ 1; filed 2022-01-01, more than 3 years before NOW ⇒ no recency multiplier.
    expect(s.weight_hint).toBe(1);
    expect(r.possible).toEqual([]);
    expect(r.could_not_check[0]).toMatch(COVERAGE);
    expect(r.could_not_check[0]).toContain("for France and the United States and a recorded index of 4 cases");
    expect(findForbidden(s.label + s.excerpt)).toEqual([]);
  });

  it("BlackRock: found through the France geography listing and the seed index, fetched once; pending and recent ⇒ 1.5", async () => {
    const f = new OfflineFetcher();
    const r = await checkLitigation("BlackRock, Inc.", { country: "France" }, guardedPageFetcher(f).pageFetcher, NOW);
    expect(r.signals.map((s) => [s.entity_name, s.weight_hint])).toEqual([["BlackRock", 1.5]]);
    expect(f.calls.filter((u) => u === DOC.blackrock)).toHaveLength(1);
  });

  it("Shell: “Royal Dutch Shell plc.” and “Shell’s Board of Directors” are possible matches — shown, never in signals", async () => {
    const r = await checkLitigation("Shell plc", { country: "United Kingdom" }, offline(), NOW);
    expect(r.signals).toEqual([]);
    expect(r.possible.map((p) => [p.party, p.url])).toEqual([
      ["Royal Dutch Shell plc.", DOC.shellNl],
      ["Shell’s Board of Directors", DOC.shellBoard],
    ]);
    const lines = r.could_not_check.filter((l) => l.startsWith("Possible match, not scored:"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("climate litigation case naming “Royal Dutch Shell plc.”");
    expect(lines[0]).toContain("A filed case is not a ruling.");
  });

  it("the fixture brands (Mammut, Fairphone, Oatly): no case names them; the coverage sentence is always there", async () => {
    for (const [brand, country] of [["Mammut", "Switzerland"], ["Fairphone", "Netherlands"], ["Oatly AB", "Sweden"]] as const) {
      const r = await checkLitigation(brand, { country }, offline(), NOW);
      expect(r.signals, brand).toEqual([]);
      expect(r.possible, brand).toEqual([]);
      expect(r.could_not_check[0], brand).toContain(`for ${country} and the United States`);
    }
  });

  it("no country on record (URL fallback): only the US listing and the seed index", async () => {
    const f = new OfflineFetcher();
    const r = await checkLitigation("Northwind Outdoor Ltd.", undefined, guardedPageFetcher(f).pageFetcher, NOW);
    expect(f.calls.filter((u) => u.includes("/geographies/"))).toEqual([GEO("united-states-of-america")]);
    expect(r.could_not_check[0]).toContain("for the United States and a recorded index");
  });

  it("a country without a known page ⇒ a could-not-check line saying so", async () => {
    const r = await checkLitigation("Mammut", { country: "Atlantis" }, offline(), NOW);
    expect(r.could_not_check).toContain("Climate litigation cases listed for Atlantis: not checked (we know no country page of the database for it).");
  });
});

describe("fictional brands (synthetic .example cases, ADR-011)", () => {
  const recorded = Object.fromEntries(Object.keys(sabinManifest().files).map((u) => [u, sabinPage(u).body]));
  const withSeed = (url: string, body: string) => new MapFetcher({ ...recorded, [url]: body });
  const SYN_N = "https://www.climatecasechart.com/document/synthetic-northwind-possible_0001";
  const SYN_Q = "https://www.climatecasechart.com/document/synthetic-quillmoor-dismissed_0002";
  const adapterWith = async (extra: string) => {
    const { sabin } = await import("@/lib/registries/sabin");
    return { ...sabin, discover: async (b: string, e: unknown, f: Parameters<typeof sabin.discover>[2]) => {
      const d = await sabin.discover(b, e, f);
      return { ...d, candidates: [...d.candidates, { url: extra, via: "seed" as const }] };
    } };
  };

  it("Northwind: a party that only contains the brand’s name ⇒ possible, never a signal", async () => {
    const r = await checkLitigation("Northwind Outdoor Ltd.", undefined, withSeed(SYN_N, synthetic("northwind-possible.html")), NOW, await adapterWith(SYN_N));
    expect(r.signals).toEqual([]);
    expect(r.possible).toEqual([{ url: SYN_N, title: "Friends of the Fjord v. Northwind Outdoor Holdings Trading Ltd", party: "Northwind Outdoor Holdings Trading Ltd" }]);
  });

  it("Quillmoor: a dismissed case naming the brand ⇒ listed with weight_hint 0 (0 points)", async () => {
    const r = await checkLitigation("Quillmoor Foods Ltd.", undefined, withSeed(SYN_Q, synthetic("quillmoor-dismissed.html")), NOW, await adapterWith(SYN_Q));
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0]).toMatchObject({ entity_name: "Quillmoor Foods Ltd.", weight_hint: 0, kind: "litigation.case" });
    expect(r.signals[0].label).toBe("Case found naming Quillmoor Foods Ltd. (Dismissed, filed 2024) — a filed case is not a ruling");
  });
});

describe("ADR-011: Sabin fixtures are real captures; synthetic pages name only fictional brands", () => {
  it("every manifest entry exists, carries a capture date and the real-capture header; every file is listed", () => {
    const files = sabinManifest().files;
    const listed = new Set(Object.values(files).map((f) => f.file));
    for (const [url, entry] of Object.entries(files)) {
      expect(existsSync(join(SABIN_DIR, entry.file)), entry.file).toBe(true);
      expect(Number.isNaN(Date.parse(entry.capturedAt)), url).toBe(false);
      expect(new URL(url).host).toBe("www.climatecasechart.com");
      const body = readFileSync(join(SABIN_DIR, entry.file), "utf8");
      if (entry.file.endsWith(".html")) {
        expect(body.startsWith(`<!-- real capture: ${url} on `), entry.file).toBe(true);
        // The app's API token is never stored (ADR-028).
        expect(body).not.toMatch(/BACKEND_API_TOKEN|eyJhbGci|ADOBE_API_KEY/);
      }
    }
    for (const f of readdirSync(SABIN_DIR)) {
      if (["manifest.json", "README.md", "index.json", "synthetic"].includes(f)) continue;
      expect(listed.has(f), `${f} is not in the manifest`).toBe(true);
    }
  });

  it("every seed-index entry is a recorded /document/ page with recorded_at and recorded_from", () => {
    expect(SEED_INDEX.length).toBeGreaterThanOrEqual(1);
    const files = sabinManifest().files;
    for (const e of SEED_INDEX) {
      expect(e.url).toMatch(/^https:\/\/www\.climatecasechart\.com\/document\/[a-z0-9_-]+$/);
      expect(files[e.url], e.url).toBeDefined();
      expect(Number.isNaN(Date.parse(e.recorded_at))).toBe(false);
      expect(e.recorded_from.length).toBeGreaterThan(0);
    }
  });

  it("synthetic pages are marked and name only the fictional brands", () => {
    for (const f of readdirSync(join(SABIN_DIR, "synthetic"))) {
      const body = synthetic(f);
      expect(body.startsWith("<!-- synthetic: hand-built for the fictional .example brand"), f).toBe(true);
      expect(body).toMatch(/Northwind|Quillmoor/);
    }
  });
});
