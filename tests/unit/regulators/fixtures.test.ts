import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { guardedPageFetcher } from "@/lib/pipeline/run";
import { receiptProblem } from "@/lib/pipeline/signal";
import { asaUk } from "@/lib/regulators/asa-uk";
import { checkRegulator } from "@/lib/regulators/check";
import { jdpFr } from "@/lib/regulators/jdp-fr";
import { OfflineFetcher } from "../helpers/brands";
import { SOURCES, sourceManifest } from "../helpers/sources";

const NOW = new Date("2026-10-20T00:00:00Z");
const offline = () => guardedPageFetcher(new OfflineFetcher()).pageFetcher;

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });

describe("regulator fixtures (5.4)", () => {
  it("Oatly (food fixture brand) has a real ASA ruling: one regulator.ruling signal with a receipt and the entity verbatim", async () => {
    const r = await checkRegulator(asaUk, "Oatly AB", offline(), NOW);
    expect(r.signals).toHaveLength(1);
    const s = r.signals[0];
    expect(receiptProblem(s)).toBeNull();
    expect(s).toMatchObject({
      axis: "track",
      kind: "regulator.ruling",
      source_url: "https://www.asa.org.uk/rulings/oatly-uk-ltd-g21-1096286-oatly-uk-ltd.html",
      entity_name: "Oatly UK Ltd t/a Oatly",
      llm_used: false,
    });
    expect(s.label).toContain("Ruling found naming Oatly UK Ltd t/a Oatly");
    expect(s.excerpt.length).toBeLessThanOrEqual(300);
    // Upheld (in part), older than 3 years on 2026-10-20: base × upheld multiplier only (config/weights.json).
    expect(s.weight_hint).toBe(2);
    expect(r.possible).toEqual([]);
  });

  it("Mammut and Fairphone: real empty searches on both sites ⇒ no ruling, nothing possible", async () => {
    for (const brand of ["Mammut", "Fairphone"]) {
      for (const adapter of [asaUk, jdpFr]) {
        const r = await checkRegulator(adapter, brand, offline(), NOW);
        expect(r.signals, `${adapter.id} ${brand}`).toEqual([]);
        expect(r.possible).toEqual([]);
      }
    }
  });

  it("the ambiguous real ASA search (Shell): exact names are scored; “Shell Energy UK” is possible, scored: false, and never enters signals", async () => {
    const r = await checkRegulator(asaUk, "Shell", offline(), NOW);
    expect(r.signals.map((s) => s.entity_name)).toEqual(["Shell UK Ltd t/a Shell", "Shell UK Ltd"]);
    expect(r.possible).toEqual([
      expect.objectContaining({ entity_name: "Shell Energy UK", scored: false, url: "https://www.asa.org.uk/rulings/shell-energy-uk-a25-1288971-shell-energy-uk-ltd.html" }),
    ]);
    expect(r.signals.some((s) => s.source_url === r.possible[0].url)).toBe(false);
    expect(r.could_not_check.join("\n")).toContain("Possible match, not scored: ASA ruling naming “Shell Energy UK”");
    // Full-text hits whose listed name does not contain the brand (LifeSafe Technologies, ZOE, Viridian) are never fetched.
    expect(r.rulings.every((x) => /shell/i.test(x.advertiser))).toBe(true);
  });

  it("weight hints: upheld and recent weigh more", async () => {
    const r = await checkRegulator(jdpFr, "TotalEnergies", offline(), NOW);
    const byUrl = Object.fromEntries(r.signals.map((s) => [s.source_url, s.weight_hint]));
    expect(byUrl["https://www.jdp-pub.org/avis/totalenergies-internet/"]).toBe(3); // upheld, 2024 (recent)
    expect(byUrl["https://www.jdp-pub.org/avis/totalenergies-presse/"]).toBe(1.5); // rejected, 2024 (recent)
    expect(byUrl["https://www.jdp-pub.org/avis/total-energies-internet/"]).toBe(2); // upheld, 2023-03 (older than 3 years)
    // ADR-033 (Phase 14): the "Heures Eco" price decision (presse) is not environmental ⇒ listed with 0 points.
    const kinds = Object.fromEntries(r.signals.map((s) => [s.source_url, s.kind]));
    expect(kinds["https://www.jdp-pub.org/avis/totalenergies-presse/"]).toBe("regulator.ruling_other_topic");
    expect(kinds["https://www.jdp-pub.org/avis/totalenergies-internet/"]).toBe("regulator.ruling");
    expect(kinds["https://www.jdp-pub.org/avis/total-energies-internet/"]).toBe("regulator.ruling");
  });

  it("ADR-011: every recorded source file is a real capture listed in the manifest; no ruling is hand-built", () => {
    const files = sourceManifest().files;
    const listed = new Set(Object.values(files).map((f) => f.file));
    for (const [url, entry] of Object.entries(files)) {
      expect(existsSync(join(SOURCES, entry.file)), entry.file).toBe(true);
      expect(Number.isNaN(Date.parse(entry.capturedAt)), url).toBe(false);
      expect(["www.asa.org.uk", "www.jdp-pub.org", "www.ifixit.com"]).toContain(new URL(url).host);
      if (entry.file.endsWith(".html")) {
        expect(readFileSync(join(SOURCES, entry.file), "utf8").startsWith(`<!-- real capture: ${url} on `), entry.file).toBe(true);
      }
    }
    for (const f of filesUnder(SOURCES)) {
      const rel = relative(SOURCES, f);
      if (rel === "manifest.json" || rel === "README.md") continue;
      expect(listed.has(rel), `${rel} is not in the manifest`).toBe(true);
    }
  });
});
