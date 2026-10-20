import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import { skippedReason } from "@/lib/copy/wording";
import { runPipeline } from "@/lib/pipeline/run";
import { discoverStep } from "@/lib/pipeline/steps/discover";
import { fetchPagesStep } from "@/lib/pipeline/steps/fetch-pages";
import type { Step } from "@/lib/pipeline/types";
import { OfflineFetcher } from "../helpers/brands";
import { tempDb } from "../helpers/db";

const DISALLOWED = "https://www.northwind-outdoor.example/stories/archive/our-footprint-2019/";

describe("pipeline skips (2.4)", () => {
  let env: ReturnType<typeof tempDb>;
  let runs: RunsRepo;
  let pages: RunPagesRepo;
  beforeEach(() => {
    env = tempDb();
    runs = new RunsRepo(env.db);
    pages = new RunPagesRepo(env.db);
  });
  afterEach(() => env.cleanup());

  // The fictional test-only fixture (ADR-011): it has a robots-disallowed page and no Wikidata id.
  const northwind = () => runs.create({ query: "northwind outdoor", brand: "Northwind Outdoor Ltd.", website: "https://www.northwind-outdoor.example" });

  it("skips a page disallowed by the fixture robots.txt, records it in the run's progress, and never requests it", async () => {
    const run = northwind();
    const fetcher = new OfflineFetcher();
    const out = await runPipeline(run, { runs, pages, fetcher });

    expect(out.status).toBe("done");
    const stored = runs.get(run.id)!;
    expect(stored.status).toBe("done");
    expect(stored.progress.slice(0, 2)).toEqual([
      { step: "Discovering pages", status: "done" },
      { step: "Fetching current pages", status: "done" },
    ]);
    const skip = stored.progress.find((p) => p.status === "skipped");
    expect(skip).toEqual({ step: `Fetching ${DISALLOWED}`, status: "skipped", reason: `robots.txt disallows ${DISALLOWED}` });
    expect(skip!.reason).toContain("robots.txt");
    expect(fetcher.calls).not.toContain(DISALLOWED);
    expect(out.could_not_check.some((c) => c.includes(DISALLOWED) && c.includes("robots.txt"))).toBe(true);

    // Pages are persisted for later steps, in fetch order.
    const saved = pages.list(run.id);
    expect(saved.length).toBeGreaterThanOrEqual(3);
    expect(saved.map((p) => p.url)).toEqual(out.pages.map((p) => p.url));
  });

  it("a step that throws is shown as skipped with its reason and the next step still runs", async () => {
    const run = northwind();
    const boom: Step = {
      id: "boom",
      label: () => "Exploding step",
      run: async () => {
        throw new Error("Wayback unreachable (429)");
      },
    };
    const out = await runPipeline(run, { runs, pages, fetcher: new OfflineFetcher(), steps: [boom, discoverStep, fetchPagesStep] });
    expect(out.status).toBe("done");
    expect(out.progress[0]).toEqual({ step: "Exploding step", status: "skipped", reason: "Wayback unreachable (429)" });
    expect(out.progress[1]).toEqual({ step: "Discovering pages", status: "done" });
    expect(out.pages.length).toBeGreaterThanOrEqual(3);
  });

  it("a site with no fetchable page ends 'Fetching current pages' as skipped with a reason", async () => {
    const run = runs.create({ query: "acme", brand: "acme", website: "https://example.com" });
    const out = await runPipeline(run, { runs, pages, fetcher: new OfflineFetcher() });
    expect(out.progress).toEqual([
      { step: "Discovering pages", status: "done" },
      { step: "Fetching current pages", status: "skipped", reason: "no page could be fetched from example.com" },
    ]);
    expect(out.could_not_check).toContain("No sustainability, impact or responsibility page could be fetched from example.com.");
  });

  it("a fetch error on a page becomes a skipped line, not silence", async () => {
    const run = northwind();
    const inner = new OfflineFetcher();
    const flaky = {
      calls: [] as string[],
      async get(url: string) {
        if (url === "https://www.northwind-outdoor.example/about-us/") throw new Error("socket hang up");
        return inner.get(url);
      },
    };
    const out = await runPipeline(run, { runs, pages, fetcher: flaky });
    expect(out.progress).toContainEqual({
      step: "Fetching https://www.northwind-outdoor.example/about-us/",
      status: "skipped",
      reason: "could not fetch https://www.northwind-outdoor.example/about-us/ (socket hang up)",
    });
  });

  it("progress is persisted while the run is in flight", async () => {
    const run = northwind();
    const seen: string[] = [];
    const spy: Step = {
      id: "spy",
      label: () => "Spy",
      run: async () => {
        seen.push(JSON.stringify(runs.get(run.id)!.progress));
        return { signals: [], could_not_check: [] };
      },
    };
    await runPipeline(run, { runs, pages, fetcher: new OfflineFetcher(), steps: [discoverStep, spy] });
    expect(JSON.parse(seen[0])).toEqual([
      { step: "Discovering pages", status: "done" },
      { step: "Spy", status: "running" },
    ]);
  });

  it("robots.txt unavailable (HTTP 503) ⇒ the site is skipped with the reason shown, and no page is requested (ADR-012)", async () => {
    const run = northwind();
    const inner = new OfflineFetcher();
    const calls: string[] = [];
    const down = {
      async get(url: string) {
        calls.push(url);
        const res = await inner.get(url);
        return url.endsWith("/robots.txt") ? { ...res, status: 503, body: "Service Unavailable" } : res;
      },
    };
    const out = await runPipeline(run, { runs, pages, fetcher: down });
    const reason = "robots.txt unavailable for https://www.northwind-outdoor.example (HTTP 503)";
    expect(out.progress).toEqual([
      { step: "Discovering pages", status: "skipped", reason },
      { step: "Fetching current pages", status: "skipped", reason: "no candidate pages were found" },
    ]);
    expect(skippedReason(out.progress[0].reason!)).toBe(`skipped: ${reason}`);
    expect(calls).toEqual(["https://www.northwind-outdoor.example/robots.txt"]);
    expect(out.pages).toEqual([]);
    expect(out.could_not_check.some((c) => c.includes("robots.txt could not be read"))).toBe(true);
    expect(runs.get(run.id)!.progress).toEqual(out.progress);
  });

  it("offline, a run on a real brand without a recorded capture (Patagonia) honestly ends with nothing fetched (ADR-011)", async () => {
    const run = runs.create({ query: "patagonia", brand: "Patagonia, Inc.", website: "https://www.patagonia.com", wikidataId: "Q1660552" });
    const out = await runPipeline(run, { runs, pages, fetcher: new OfflineFetcher() });
    expect(out.pages).toEqual([]);
    expect(out.progress).toContainEqual({
      step: "Fetching current pages",
      status: "skipped",
      reason: "no page could be fetched from patagonia.com",
    });
  });
});
