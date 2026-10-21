import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanPage } from "@/lib/claims/engine";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import { runPipeline } from "@/lib/pipeline/run";
import { assertReceipt } from "@/lib/pipeline/signal";
import { BRANDS, OfflineFetcher, loadBrandPage } from "../helpers/brands";
import { tempDb } from "../helpers/db";

describe("claim engine on the real fixture brands (3.4)", () => {
  it.each(BRANDS.map((b) => [b.slug, b]))("%s: the sustainability page gives ≥ 1 receipted signal with llm_used false", (_slug, b) => {
    const page = loadBrandPage(b.slug, b.sustainabilityPage, b.sustainabilityUrl);
    const { signals, stats } = scanPage(page.text, { url: page.url, fetchedAt: page.fetchedAt, links: page.links });
    expect(signals.length).toBeGreaterThanOrEqual(1);
    for (const s of signals) {
      expect(() => assertReceipt(s)).not.toThrow();
      expect(s.llm_used).toBe(false);
      expect(s.source_url).toBe(b.sustainabilityUrl);
      expect(s.fetched_at.startsWith("2026-10-20")).toBe(true);
      // The excerpt is a quote of the page text (or a cut of one).
      expect(page.text.replace(/\s+/g, " ")).toContain(s.excerpt.replace(/^…|…$/g, "").slice(0, 60));
    }
    expect(stats.wordCount).toBe(page.wordCount);
  });
});

describe("pipeline wiring", () => {
  let env: ReturnType<typeof tempDb>;
  beforeEach(() => {
    env = tempDb();
  });
  afterEach(() => env.cleanup());

  it("Fairphone offline: claims and evidence steps run after page fetching and emit receipted, rule-based signals", async () => {
    const runs = new RunsRepo(env.db);
    const pages = new RunPagesRepo(env.db);
    const run = runs.create({ query: "fairphone", brand: "Fairphone", website: "https://www.fairphone.com/" });
    const out = await runPipeline(run, { runs, pages, fetcher: new OfflineFetcher(), now: () => new Date("2026-10-20T12:00:00Z") });
    expect(out.status).toBe("done");
    const steps = out.progress.filter((p) => !p.step.startsWith("Fetching http")).map((p) => [p.step, p.status]);
    expect(steps).toEqual([
      ["Discovering pages", "done"],
      ["Fetching current pages", "done"],
      // No Wayback history is recorded for the real brands (web.archive.org was unreachable from the build container).
      ["Pulling 2019–2026 snapshots", "skipped"],
      ["Checking claim language", "done"],
      // Phase 7: no LLM client in this test.
      ["Proposing candidate claims (AI)", "skipped"],
      ["Classifying archived changes (AI)", "skipped"],
      ["Checking published evidence", "done"],
      // Phase 5: real recorded searches (no ruling for Fairphone) and the repair axis.
      ["Checking ASA (UK) rulings", "done"],
      ["Checking JDP (France) decisions", "done"],
      ["Checking the climate litigation database", "done"],
      ["Checking repair information", "done"],
      ["Writing the plain-English summary (AI)", "skipped"],
    ]);
    expect(out.signals.filter((s) => s.axis === "claims").length).toBeGreaterThan(0);
    expect(out.signals.filter((s) => s.axis === "evidence").length).toBeGreaterThan(0);
    for (const s of out.signals) {
      assertReceipt(s);
      expect(s.llm_used).toBe(false);
    }
    expect(new Set(out.signals.map((s) => s.id)).size).toBe(out.signals.length);
    expect(out.claim_stats?.wordCount).toBe(out.pages.reduce((n, p) => n + p.wordCount, 0));
    // Fairtrade is named on the site: listed under "could not check", never scored.
    expect(out.could_not_check.some((c) => c.startsWith("Fairtrade: label claimed on page; not verified in v1"))).toBe(true);
  });

  it("a run with no fetched pages skips both steps with a reason", async () => {
    const runs = new RunsRepo(env.db);
    const pages = new RunPagesRepo(env.db);
    const run = runs.create({ query: "acme", brand: "Acme", website: "https://example.com" });
    const out = await runPipeline(run, { runs, pages, fetcher: new OfflineFetcher() });
    const claims = out.progress.find((p) => p.step === "Checking claim language");
    expect(claims).toEqual({ step: "Checking claim language", status: "skipped", reason: "no fetched page to scan" });
    expect(out.signals).toEqual([]);
  });
});
