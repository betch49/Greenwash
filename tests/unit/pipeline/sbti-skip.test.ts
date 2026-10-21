import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import { FetchError, type FetchResult, type Fetcher } from "@/lib/fetch/fetcher";
import { runPipeline } from "@/lib/pipeline/run";
import { sbtiStep } from "@/lib/pipeline/steps/sbti";
import type { Step } from "@/lib/pipeline/types";
import { SBTI_CONFIG } from "@/lib/registries/sbti";
import { OfflineFetcher } from "../helpers/brands";
import { tempDb } from "../helpers/db";

const NOW = () => new Date("2026-10-21T12:00:00Z");
const SBTI = "Checking SBTi target status";
const NEXT = "Next step";

/** Fixtures for everything, except that the SBTi export answers with `answer`. */
function failing(answer: (url: string) => Promise<FetchResult>): Fetcher {
  const inner = new OfflineFetcher();
  return { get: (url, opts) => (url === SBTI_CONFIG.exportUrl ? answer(url) : inner.get(url, opts)) };
}
const result = (status: number, bytes?: Buffer) => async (url: string): Promise<FetchResult> => ({
  url,
  status,
  body: "",
  contentType: "application/octet-stream",
  fetchedAt: NOW().toISOString(),
  source: "network",
  ...(bytes ? { bytes } : {}),
});

describe("SBTi step skips with a reason; the next step runs (11.3)", () => {
  let env: ReturnType<typeof tempDb>;
  let runs: RunsRepo;
  let pages: RunPagesRepo;
  let ran: boolean;
  const next: Step = {
    id: "next",
    label: () => NEXT,
    async run() {
      ran = true;
      return { signals: [], could_not_check: [] };
    },
  };
  beforeEach(() => {
    env = tempDb();
    runs = new RunsRepo(env.db);
    pages = new RunPagesRepo(env.db);
    ran = false;
  });
  afterEach(() => env.cleanup());

  const amazon = () => runs.create({ query: "amazon", brand: "Amazon", website: "https://www.amazon.com/" });

  it.each([
    ["HTTP 500", result(500), "SBTi export unreachable (HTTP 500)"],
    ["a 503 after retries", async () => Promise.reject(new FetchError("HTTP 503 after 3 tries", "x", 503)), "SBTi export unreachable (HTTP 503)"],
    ["a thrown network error", async () => Promise.reject(new FetchError("Network error after 3 tries: read ECONNRESET", "x")), "SBTi export unreachable (Network error after 3 tries: read ECONNRESET)"],
    ["a corrupt xlsx", result(200, Buffer.from("PK\u0003\u0004 truncated")), "SBTi export could not be parsed"],
    ["an HTML page instead of the export", result(200, Buffer.from("<html><body>Maintenance</body></html>")), "SBTi export could not be parsed"],
  ] as const)("the export answering %s ⇒ “skipped: %s”", async (_n, answer, reason) => {
    const out = await runPipeline(amazon(), { runs, pages, fetcher: failing(answer), now: NOW, steps: [sbtiStep, next] });
    expect(out.status).toBe("done");
    expect(out.progress.find((p) => p.step === SBTI)).toEqual({ step: SBTI, status: "skipped", reason });
    expect(out.progress.find((p) => p.step === NEXT)).toEqual({ step: NEXT, status: "done" });
    expect(ran).toBe(true);
    expect(out.signals).toEqual([]);
    expect(out.step_status.sbti).toBe("skipped");
    expect(out.could_not_check).toContain(`SBTi target status: not checked (${reason}).`);
  });

  it("offline, the recorded export is read: Amazon gets one receipted removal and the step ends done", async () => {
    const out = await runPipeline(amazon(), { runs, pages, fetcher: new OfflineFetcher(), now: NOW, steps: [sbtiStep, next] });
    expect(out.progress.find((p) => p.step === SBTI)).toEqual({ step: SBTI, status: "done" });
    expect(out.signals.map((s) => s.kind)).toEqual(["sbti.commitment_removed"]);
    expect(out.signals[0].excerpt).toContain("Source: Science Based Targets initiative, Target Dashboard export (");
    expect(out.could_not_check[0]).toMatch(/^SBTi target status: read from the SBTi Target Dashboard export/);
  });

  it("a possible match goes to “What we could not check”, never to signals", async () => {
    const run = runs.create({ query: "mammut", brand: "Mammut", website: "https://www.mammut.com/us/en/" });
    const out = await runPipeline(run, { runs, pages, fetcher: new OfflineFetcher(), now: NOW, steps: [sbtiStep] });
    expect(out.signals).toEqual([]);
    expect(out.could_not_check.filter((c) => c.startsWith("Possible match, not scored: SBTi Target Dashboard entry “Mammut Sports Group”"))).toHaveLength(1);
  });
});
