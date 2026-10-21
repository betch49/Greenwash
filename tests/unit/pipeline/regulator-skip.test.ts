import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import { FetchError, type FetchResult, type Fetcher } from "@/lib/fetch/fetcher";
import { runPipeline } from "@/lib/pipeline/run";
import { asaStep, jdpStep } from "@/lib/pipeline/steps/regulators";
import { OfflineFetcher } from "../helpers/brands";
import { tempDb } from "../helpers/db";

const NOW = () => new Date("2026-10-20T12:00:00Z");
const ASA = "Checking ASA (UK) rulings";
const JDP = "Checking JDP (France) decisions";

/** Fixtures for everything, except that pages on `host` (not its robots.txt) answer with `answer`. */
function failing(host: string, answer: (url: string) => Promise<FetchResult>): Fetcher {
  const inner = new OfflineFetcher();
  return { get: (url) => (new URL(url).host === host && !url.endsWith("/robots.txt") ? answer(url) : inner.get(url)) };
}
const status = (s: number) => async (url: string): Promise<FetchResult> => ({ url, status: s, body: "", contentType: "text/html", fetchedAt: NOW().toISOString(), source: "network" });

describe("regulator steps skip with a reason; the other adapter still runs (5.5)", () => {
  let env: ReturnType<typeof tempDb>;
  let runs: RunsRepo;
  let pages: RunPagesRepo;
  beforeEach(() => {
    env = tempDb();
    runs = new RunsRepo(env.db);
    pages = new RunPagesRepo(env.db);
  });
  afterEach(() => env.cleanup());

  const oatly = () => runs.create({ query: "oatly", brand: "Oatly AB", website: "https://www.oatly.com/" });

  it.each([
    ["HTTP 500", status(500), "ASA unreachable (HTTP 500)"],
    ["a thrown network error", async () => Promise.reject(new FetchError("Network error after 3 tries: read ECONNRESET", "x")), "ASA unreachable (Network error after 3 tries: read ECONNRESET)"],
    ["a 503 after retries", async () => Promise.reject(new FetchError("HTTP 503 after 3 tries", "x", 503)), "ASA unreachable (HTTP 503)"],
    ["a page that is not an ASA search page", async (url: string) => ({ ...(await status(200)(url)), body: "<html><body>Service temporarily unavailable</body></html>" }), "ASA search page could not be parsed"],
  ] as const)("ASA answering %s ⇒ “skipped: %s”; JDP still runs and ends done", async (_n, answer, reason) => {
    const out = await runPipeline(oatly(), { runs, pages, fetcher: failing("www.asa.org.uk", answer), now: NOW, steps: [asaStep, jdpStep] });
    expect(out.status).toBe("done");
    expect(out.progress.find((p) => p.step === ASA)).toEqual({ step: ASA, status: "skipped", reason });
    expect(out.progress.find((p) => p.step === JDP)).toEqual({ step: JDP, status: "done" });
    expect(out.signals).toEqual([]);
    expect(out.could_not_check).toContain(`ASA rulings: not checked (${reason}).`);
    expect(out.could_not_check.filter((l) => l.startsWith("Regulator rulings: only the UK ASA"))).toHaveLength(1);
  });

  it("JDP failing does not stop ASA: the Oatly ruling is still found", async () => {
    const out = await runPipeline(oatly(), { runs, pages, fetcher: failing("www.jdp-pub.org", status(500)), now: NOW, steps: [asaStep, jdpStep] });
    expect(out.progress.find((p) => p.step === JDP)).toEqual({ step: JDP, status: "skipped", reason: "JDP unreachable (HTTP 500)" });
    expect(out.progress.find((p) => p.step === ASA)?.status).toBe("done");
    expect(out.signals.map((s) => s.kind)).toEqual(["regulator.ruling"]);
  });

  it("robots.txt that disallows the search page ⇒ skipped with the robots reason, nothing fetched", async () => {
    const inner = new OfflineFetcher();
    const calls: string[] = [];
    const fetcher: Fetcher = {
      get: async (url) => {
        calls.push(url);
        if (url === "https://www.asa.org.uk/robots.txt") return { ...(await status(200)(url)), contentType: "text/plain", body: "User-agent: *\nDisallow: /search.html\n" };
        return inner.get(url);
      },
    };
    const out = await runPipeline(oatly(), { runs, pages, fetcher, now: NOW, steps: [asaStep] });
    expect(out.progress[0]).toEqual({ step: ASA, status: "skipped", reason: "robots.txt disallows https://www.asa.org.uk/search.html?q=Oatly" });
    expect(calls).toEqual(["https://www.asa.org.uk/robots.txt"]);
  });

  it("one ruling page failing ⇒ a skipped progress line for that page; the step itself is done", async () => {
    const inner = new OfflineFetcher();
    const fetcher: Fetcher = { get: (url) => (url.includes("/rulings/") ? status(502)(url) : inner.get(url)) };
    const out = await runPipeline(oatly(), { runs, pages, fetcher, now: NOW, steps: [asaStep] });
    expect(out.progress[0]).toEqual({ step: ASA, status: "done" });
    expect(out.progress[1]).toMatchObject({ status: "skipped", reason: "ASA unreachable (HTTP 502)" });
    expect(out.signals).toEqual([]);
  });
});
