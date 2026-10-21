// PLAN criterion 7.8 (ADR-017): the live page is the last element of a page's history.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunOutputsRepo } from "@/lib/db/run-outputs-repo";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import type { Fetcher } from "@/lib/fetch/fetcher";
import { runPipeline } from "@/lib/pipeline/run";
import { discoverStep } from "@/lib/pipeline/steps/discover";
import { fetchPagesStep } from "@/lib/pipeline/steps/fetch-pages";
import { waybackStep } from "@/lib/pipeline/steps/wayback";
import { detectRetractions } from "@/lib/wayback/retraction";
import type { Snapshot } from "@/lib/wayback/snapshot";
import { OfflineFetcher } from "../helpers/brands";
import { tempDb } from "../helpers/db";
import { NORTHWIND_FOOTPRINT, QUILLMOOR_SUSTAINABILITY } from "./history";

const NOW = () => new Date("2026-10-20T12:00:00Z");
const steps = [discoverStep, fetchPagesStep, waybackStep];
const LIVE_LABEL = /claim removed between 2025 and the current page/i;
const NEWEST_ID = "https://web.archive.org/web/20250410172230id_/https://www.northwind-outdoor.example/our-footprint/";

describe("newest snapshot vs the live page (7.8, ADR-017)", () => {
  let env: ReturnType<typeof tempDb>;
  let runs: RunsRepo;
  const deps = (fetcher: Fetcher = new OfflineFetcher()) => ({ runs, pages: new RunPagesRepo(env.db), outputs: new RunOutputsRepo(env.db), fetcher, now: NOW, steps });
  beforeEach(() => {
    env = tempDb();
    runs = new RunsRepo(env.db);
  });
  afterEach(() => env.cleanup());

  it("Northwind: the 2025 archived claim missing from the live page ⇒ exactly one claim.removed 'between 2025 and the current page', receipt = the 2025 id_ URL", async () => {
    const run = runs.create({ query: "northwind outdoor", brand: "Northwind Outdoor Ltd.", website: "https://www.northwind-outdoor.example" });
    const out = await runPipeline(run, deps());
    const live = out.signals.filter((s) => s.kind === "claim.removed" && LIVE_LABEL.test(s.label));
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ axis: "track", source_url: NEWEST_ID, snapshot_date: "2025-04-10", llm_used: false });
    expect(live[0].excerpt).toContain("Our dyes are eco-friendly");
    expect(live[0].label).toBe("Claim removed between 2025 and the current page: present in the 2025 archived copy, absent from the page as fetched on 2026-10-20");
    // The older removal (2021 → 2024) is unchanged.
    expect(out.signals.filter((s) => s.kind === "claim.removed" && !LIVE_LABEL.test(s.label)).map((s) => s.label)).toEqual([
      "Claim removed between 2021 and 2024: present in the 2021 archived copy of the page, absent from the 2024 copy",
    ]);
    // A diff candidate for the classifier, its later copy marked live.
    const cand = out.diff_candidates.find((c) => c.signalId === live[0].id)!;
    expect(cand.to).toMatchObject({ snapshotUrl: NORTHWIND_FOOTPRINT, live: true });
    expect(cand.from.snapshotUrl).toBe(NEWEST_ID);
    // Timeline: the live page is the last row of the page, year = the run's year, URL = the page URL.
    const rows = out.timeline.filter((t) => t.page_url === NORTHWIND_FOOTPRINT);
    expect(rows.map((r) => r.year)).toEqual([2020, 2021, 2024, 2025, 2026]);
    expect(rows[4]).toMatchObject({ live: true, snapshot_url: NORTHWIND_FOOTPRINT, snapshot_date: "2026-10-20", previous_year: 2025, claims_removed: ["Our dyes are eco-friendly and kind to rivers."] });
    expect(rows.slice(0, 4).every((r) => r.live === undefined)).toBe(true);
  });

  it("Quillmoor: every archived claim is still on the live page ⇒ a live row and no removal", async () => {
    const run = runs.create({ query: "quillmoor", brand: "Quillmoor Foods Ltd.", website: "https://www.quillmoor-foods.example" });
    const out = await runPipeline(run, deps());
    expect(out.signals.filter((s) => s.kind === "claim.removed")).toEqual([]);
    const rows = out.timeline.filter((t) => t.page_url === QUILLMOOR_SUSTAINABILITY);
    expect(rows.at(-1)).toMatchObject({ live: true, year: 2026, claims_removed: [] });
    expect(rows.at(-1)!.claims_present.length).toBeGreaterThan(0);
  });

  it("a robots-disallowed page (no live text) gets its archived history only, no live comparison", async () => {
    const ARCHIVE = "https://www.northwind-outdoor.example/stories/archive/our-footprint-2019/";
    const inner = new OfflineFetcher();
    // Serve the footprint history (which ends with a claim the live footprint page lacks) for the disallowed page.
    const fetcher: Fetcher = { get: (url) => inner.get(new URL(url).host === "web.archive.org" ? url.replace(encodeURIComponent(ARCHIVE), encodeURIComponent(NORTHWIND_FOOTPRINT)) : url) };
    const run = runs.create({ query: "northwind outdoor", brand: "Northwind Outdoor Ltd.", website: "https://www.northwind-outdoor.example" });
    const out = await runPipeline(run, deps(fetcher));
    const rows = out.timeline.filter((t) => t.page_url === ARCHIVE);
    expect(rows).toHaveLength(4);
    expect(rows.some((r) => r.live)).toBe(false);
    expect(out.diff_candidates.filter((c) => c.pageUrl === ARCHIVE).some((c) => c.to.live)).toBe(false);
  });

  it("detectRetractions puts the live entry last whatever its timestamp", () => {
    const snap = (year: number, text: string, live = false): Snapshot => ({
      pageUrl: "https://a.example/footprint",
      timestamp: live ? "20000101000000" : `${year}0101000000`,
      year,
      date: `${year}-01-01`,
      snapshotUrl: live ? "https://a.example/footprint" : `https://web.archive.org/web/${year}0101000000id_/https://a.example/footprint`,
      original: "https://a.example/footprint",
      title: "Footprint",
      text,
      fetchedAt: "2026-01-01T00:00:00.000Z",
      ...(live ? { live: true } : {}),
    });
    const r = detectRetractions([snap(2026, "We make jackets.", true), snap(2024, "We make jackets.\nOur jackets are eco-friendly.")]);
    expect(r.timeline.map((t) => t.live ?? false)).toEqual([false, true]);
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0].source_url).toBe("https://web.archive.org/web/20240101000000id_/https://a.example/footprint");
    expect(r.signals[0].label).toMatch(/^Claim removed between 2024 and the current page/);
  });
});
