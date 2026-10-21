import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import { FetchError, type FetchResult, type Fetcher } from "@/lib/fetch/fetcher";
import { DEFAULT_STEPS, runPipeline } from "@/lib/pipeline/run";
import { jdpStep } from "@/lib/pipeline/steps/regulators";
import { repairStep } from "@/lib/pipeline/steps/repair";
import { sabinStep } from "@/lib/pipeline/steps/sabin";
import { OfflineFetcher } from "../helpers/brands";
import { tempDb } from "../helpers/db";

const NOW = () => new Date("2026-10-21T12:00:00Z");
const STEP = "Checking the climate litigation database";
const HOST = "www.climatecasechart.com";

function failing(answer: (url: string) => Promise<FetchResult>, only?: (url: string) => boolean): Fetcher {
  const inner = new OfflineFetcher();
  return { get: (url) => (new URL(url).host === HOST && !url.endsWith("/robots.txt") && (!only || only(url)) ? answer(url) : inner.get(url)) };
}
const status = (s: number) => async (url: string): Promise<FetchResult> => ({ url, status: s, body: "", contentType: "text/html", fetchedAt: NOW().toISOString(), source: "network" });

describe("sabin step (13.6)", () => {
  let env: ReturnType<typeof tempDb>;
  let runs: RunsRepo;
  let pages: RunPagesRepo;
  beforeEach(() => {
    env = tempDb();
    runs = new RunsRepo(env.db);
    pages = new RunPagesRepo(env.db);
  });
  afterEach(() => env.cleanup());

  const fairphone = () => ({ ...runs.create({ query: "fairphone", brand: "Fairphone", website: "https://www.fairphone.com/" }), entity: { country: "Netherlands" } });

  it("runs after jdp-fr and before repair; on the track axis's confidence steps", () => {
    const ids = DEFAULT_STEPS.map((s) => s.id);
    expect(ids.indexOf("sabin")).toBe(ids.indexOf("jdp-fr") + 1);
    expect(ids.indexOf("sabin")).toBeLessThan(ids.indexOf("repair"));
  });

  it.each([
    ["HTTP 500", status(500), "climatecasechart.com unreachable (HTTP 500)"],
    ["a thrown network error", async () => Promise.reject(new FetchError("Network error after 3 tries: read ECONNRESET", "x")), "climatecasechart.com unreachable (Network error after 3 tries: read ECONNRESET)"],
    ["a 503 after retries", async () => Promise.reject(new FetchError("HTTP 503 after 3 tries", "x", 503)), "climatecasechart.com unreachable (HTTP 503)"],
    ["a thrown non-fetch error", async () => Promise.reject(new Error("socket hang up")), "climatecasechart.com unreachable (socket hang up)"],
  ] as const)("site answering %s ⇒ “skipped: %s”; jdp and repair still run", async (_n, answer, reason) => {
    const out = await runPipeline(fairphone(), { runs, pages, fetcher: failing(answer), now: NOW, steps: [jdpStep, sabinStep, repairStep] });
    expect(out.status).toBe("done");
    expect(out.progress.find((p) => p.step === STEP)).toEqual({ step: STEP, status: "skipped", reason });
    expect(out.step_status).toMatchObject({ "jdp-fr": "done", sabin: "skipped", repair: "done" });
    expect(out.could_not_check).toContain(`Climate litigation database: not checked (${reason}).`);
    // The coverage sentence is there even when the step is skipped (13.7).
    expect(out.could_not_check.some((l) => l.startsWith("Climate litigation coverage: only the newest cases listed for Netherlands and the United States"))).toBe(true);
    expect(out.signals.some((s) => s.kind === "litigation.case")).toBe(false);
  });

  it("one case page failing ⇒ a progress line and a could-not-check line; the step ends done", async () => {
    const out = await runPipeline(fairphone(), { runs, pages, fetcher: failing(status(500), (u) => u.includes("/document/clientearth-v-blackrock")), now: NOW, steps: [sabinStep] });
    expect(out.progress[0]).toEqual({ step: STEP, status: "done" });
    const line = out.progress.find((p) => p.step.startsWith("Fetching case page https://www.climatecasechart.com/document/clientearth-v-blackrock_51f1"));
    expect(line).toMatchObject({ status: "skipped", reason: "climatecasechart.com unreachable (HTTP 500)" });
  });

  it("a case page without the expected structure ⇒ “case page could not be parsed (<url>)”", async () => {
    const bad = async (url: string) => ({ ...(await status(200)(url)), body: "<html><body>maintenance</body></html>" });
    const out = await runPipeline(fairphone(), { runs, pages, fetcher: failing(bad, (u) => u.includes("/document/clientearth-v-blackrock")), now: NOW, steps: [sabinStep] });
    const url = "https://www.climatecasechart.com/document/clientearth-v-blackrock_51f1";
    expect(out.progress.find((p) => p.step === `Fetching case page ${url}`)).toMatchObject({ status: "skipped", reason: `case page could not be parsed (${url})` });
  });

  it("robots.txt disallowing the geography pages ⇒ skipped with the robots reason", async () => {
    const inner = new OfflineFetcher();
    const fetcher: Fetcher = {
      get: async (url) => (url === `https://${HOST}/robots.txt` ? { ...(await status(200)(url)), contentType: "text/plain", body: "User-agent: *\nDisallow: /geographies/\n" } : inner.get(url)),
    };
    const out = await runPipeline(fairphone(), { runs, pages, fetcher, now: NOW, steps: [sabinStep] });
    expect(out.progress[0]).toEqual({ step: STEP, status: "skipped", reason: `robots.txt disallows https://${HOST}/geographies/netherlands` });
  });
});
