import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunTimelineRepo } from "@/lib/db/run-timeline-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import { FetchError, type Fetcher } from "@/lib/fetch/fetcher";
import { runPipeline } from "@/lib/pipeline/run";
import { claimsStep } from "@/lib/pipeline/steps/claims";
import { discoverStep } from "@/lib/pipeline/steps/discover";
import { fetchPagesStep } from "@/lib/pipeline/steps/fetch-pages";
import { waybackStep, waybackTargets } from "@/lib/pipeline/steps/wayback";
import { OfflineFetcher } from "../helpers/brands";
import { tempDb } from "../helpers/db";

const NOW = () => new Date("2026-10-20T12:00:00Z");
const STEP = "Pulling 2019–2026 snapshots";
const steps = [discoverStep, fetchPagesStep, waybackStep, claimsStep];

/** Brand pages from fixtures; web.archive.org answers through `wayback`. */
const withWayback = (wayback: (url: string) => Promise<Awaited<ReturnType<Fetcher["get"]>>>): Fetcher & { calls: string[] } => {
  const inner = new OfflineFetcher();
  const calls: string[] = [];
  return {
    calls,
    get: (url: string) => {
      if (new URL(url).host === "web.archive.org") {
        calls.push(url);
        return wayback(url);
      }
      return inner.get(url);
    },
  };
};
const status = (s: number) => async (url: string) => ({ url, status: s, body: "", contentType: "text/html", fetchedAt: NOW().toISOString(), source: "network" as const });

describe("Wayback step (4.6)", () => {
  let env: ReturnType<typeof tempDb>;
  let runs: RunsRepo;
  let pages: RunPagesRepo;
  let timeline: RunTimelineRepo;
  beforeEach(() => {
    env = tempDb();
    runs = new RunsRepo(env.db);
    pages = new RunPagesRepo(env.db);
    timeline = new RunTimelineRepo(env.db);
  });
  afterEach(() => env.cleanup());

  const northwind = () => runs.create({ query: "northwind outdoor", brand: "Northwind Outdoor Ltd.", website: "https://www.northwind-outdoor.example" });

  it.each([
    ["a connection reset", async () => Promise.reject(new FetchError("Network error after 3 tries: read ECONNRESET", "x")), "Wayback unreachable (read ECONNRESET)"],
    ["429 after retries", async () => Promise.reject(new FetchError("HTTP 429 after 3 tries", "x", 429)), "Wayback unreachable (HTTP 429)"],
    ["a 429 response", status(429), "Wayback unreachable (HTTP 429)"],
    ["a 503 response", status(503), "Wayback unreachable (HTTP 503)"],
    ["404 for every page", status(404), "Wayback unreachable (HTTP 404)"],
  ] as const)("%s ⇒ skipped with a reason naming Wayback; the run continues to the next step", async (_name, answer, reason) => {
    const run = northwind();
    const fetcher = withWayback(answer);
    const out = await runPipeline(run, { runs, pages, timeline, fetcher, now: NOW, steps });

    expect(out.status).toBe("done");
    const line = out.progress.find((p) => p.step === STEP);
    expect(line).toEqual({ step: STEP, status: "skipped", reason });
    expect(line!.reason).toContain("Wayback");
    // Stopped at the first failure instead of hammering the archive.
    expect(fetcher.calls.length).toBeLessThanOrEqual(3);
    expect(out.progress[out.progress.length - 1]).toEqual({ step: "Checking claim language", status: "done" });
    expect(out.could_not_check.some((c) => c.includes("Wayback unreachable"))).toBe(true);
    expect(out.signals.filter((s) => s.kind === "claim.removed")).toEqual([]);
  });

  it("offline fixtures: the step is done, emits the removed claim, and the timeline is persisted", async () => {
    const run = northwind();
    const out = await runPipeline(run, { runs, pages, timeline, fetcher: new OfflineFetcher(), now: NOW });
    expect(out.progress.find((p) => p.step === STEP)).toEqual({ step: STEP, status: "done" });
    const removed = out.signals.filter((s) => s.kind === "claim.removed");
    expect(removed).toHaveLength(1);
    expect(out.diff_candidates).toHaveLength(1);
    const stored = timeline.list(run.id);
    expect(stored).toEqual(out.timeline);
    expect(stored.find((t) => t.claims_removed.length > 0)).toMatchObject({ year: 2024, previous_year: 2021 });
    // Pages without archived copies are listed under "what we could not check", not hidden.
    expect(out.could_not_check).toContain(
      "https://www.northwind-outdoor.example/stories/archive/our-footprint-2019/: no archived snapshot from 2019–2026 in the Wayback Machine.",
    );
  });

  it("Wayback endpoints are not robots-guarded, brand pages are (ADR-010): the robots-disallowed page gets a history lookup", async () => {
    const run = northwind();
    const fetcher = new OfflineFetcher();
    await runPipeline(run, { runs, pages, timeline, fetcher, now: NOW });
    const cdx = fetcher.calls.filter((u) => u.startsWith("https://web.archive.org/cdx/"));
    expect(cdx.some((u) => u.includes(encodeURIComponent("https://www.northwind-outdoor.example/stories/archive/our-footprint-2019/")))).toBe(true);
    expect(fetcher.calls).not.toContain("https://www.northwind-outdoor.example/stories/archive/our-footprint-2019/");
  });

  it("targets: disallowed sustainability pages first, then fetched ones, capped at maxPages, never non-sustainability pages", () => {
    const config = { sustainabilityKeywords: ["footprint", "climate"] } as never;
    const page = (url: string) => ({ url }) as never;
    const t = waybackTargets(
      { robotsDisallowed: ["https://a.example/archive/footprint-2019/"], pages: [page("https://a.example/about/"), page("https://a.example/footprint/"), page("https://a.example/climate/"), page("https://a.example/climate-2/")], config },
      { years: 8, maxPages: 3, sameClaimSimilarity: 0.8, contextSentences: 2, minIntervalMs: 1000 },
    );
    expect(t).toEqual(["https://a.example/archive/footprint-2019/", "https://a.example/footprint/", "https://a.example/climate/"]);
  });

  it("no sustainability-type page ⇒ skipped with a reason", async () => {
    const run = runs.create({ query: "acme", brand: "acme", website: "https://example.com" });
    const out = await runPipeline(run, { runs, pages, timeline, fetcher: new OfflineFetcher(), now: NOW });
    expect(out.progress.find((p) => p.step === STEP)).toEqual({
      step: STEP,
      status: "skipped",
      reason: "no sustainability-type page to look up in the Wayback Machine",
    });
  });
});
