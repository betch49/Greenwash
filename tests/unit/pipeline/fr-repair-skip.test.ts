// Criterion 12.6: a connection reset on the data.gouv.fr API is retried per the v1 policy
// (UndiciFetcher: 3 tries, exponential backoff), then "skipped: data.gouv.fr unreachable (…)";
// the run goes on. Plus the step's other paths: not applicable, parse failure, and the
// replacement of repair.no_repair_info_found.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MockAgent } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import { UndiciFetcher, type Fetcher } from "@/lib/fetch/fetcher";
import { runPipeline } from "@/lib/pipeline/run";
import type { Signal } from "@/lib/pipeline/signal";
import { discoverStep } from "@/lib/pipeline/steps/discover";
import { fetchPagesStep } from "@/lib/pipeline/steps/fetch-pages";
import { frRepairStep } from "@/lib/pipeline/steps/fr-repair";
import { repairStep } from "@/lib/pipeline/steps/repair";
import type { Step } from "@/lib/pipeline/types";
import { OfflineFetcher } from "../helpers/brands";
import { tempDb } from "../helpers/db";
import { LogFetcher, firstPage, syntheticApiPage } from "../registries/fr-helpers";

const FR = "Checking the French repairability index";
const robots = readFileSync(join("fixtures", "sources", "fr-repair", "robots", "www-data-gouv-fr.txt"), "utf8");
const after: Step = { id: "after", label: () => "After", run: async () => ({ signals: [], could_not_check: [] }) };

describe("fr-repair step skips (12.6)", () => {
  let env: ReturnType<typeof tempDb>;
  let runs: RunsRepo;
  let pages: RunPagesRepo;
  let agent: MockAgent;
  beforeEach(() => {
    env = tempDb();
    runs = new RunsRepo(env.db);
    pages = new RunPagesRepo(env.db);
    agent = new MockAgent();
    agent.disableNetConnect();
  });
  afterEach(async () => {
    env.cleanup();
    await agent.close();
  });

  it("connection reset ⇒ 3 tries with backoff, then skipped: data.gouv.fr unreachable (…); the repair step and the next step still run", async () => {
    const pool = agent.get("https://www.data.gouv.fr");
    pool.intercept({ path: "/robots.txt", method: "GET" }).reply(200, robots, { headers: { "content-type": "text/plain" } });
    let apiTries = 0;
    for (let i = 0; i < 3; i++) {
      pool
        .intercept({ path: (p) => p.startsWith("/api/1/datasets/"), method: "GET" })
        .replyWithError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
    }
    const sleeps: number[] = [];
    const live = new UndiciFetcher({ dispatcher: agent, sleep: async (ms) => void sleeps.push(ms) });
    const offline = new OfflineFetcher();
    const fetcher: Fetcher = {
      async get(url, opts) {
        if (new URL(url).host === "www.data.gouv.fr") {
          if (url.includes("/api/1/datasets/")) apiTries++;
          return live.get(url, opts);
        }
        return offline.get(url);
      },
    };
    const m = JSON.parse(readFileSync(join("fixtures", "brands", "fairphone", "meta.json"), "utf8")) as { website: string; entity: { id: string; name: string } };
    const run = runs.create({ query: "fairphone", brand: "Fairphone", website: m.website, wikidataId: m.entity.id, entity: m.entity });
    const out = await runPipeline(run, { runs, pages, fetcher, now: () => new Date("2026-10-20T12:00:00Z"), steps: [discoverStep, fetchPagesStep, repairStep, frRepairStep, after] });
    expect(apiTries).toBe(1); // one logical request; UndiciFetcher retried it internally
    expect(agent.pendingInterceptors()).toHaveLength(0); // all three attempts were consumed
    expect(sleeps).toEqual([1000, 2000]);
    const fr = out.progress.find((p) => p.step === FR)!;
    expect(fr.status).toBe("skipped");
    expect(fr.reason).toBe("data.gouv.fr unreachable (Network error after 3 tries: read ECONNRESET)");
    expect(out.progress.find((p) => p.step === "Checking repair information")).toEqual({ step: "Checking repair information", status: "done" });
    expect(out.progress.find((p) => p.step === "After")).toEqual({ step: "After", status: "done" });
    expect(out.could_not_check).toContain("French repairability index: not checked (data.gouv.fr unreachable (Network error after 3 tries: read ECONNRESET)).");
    expect(out.step_status["fr-repair"]).toBe("skipped");
    expect(out.signals.some((s) => s.kind.startsWith("repair.fr_index"))).toBe(false);
  });

  it("HTTP 503 on every try ⇒ skipped: data.gouv.fr unreachable (HTTP 503)", async () => {
    const f = new LogFetcher({});
    const fetcher: Fetcher = { get: async (url) => (url.includes("/api/1/") ? { ...(await f.get(url)), status: 503 } : f.get(url)) };
    const run = runs.create({ query: "x", brand: "Fairphone", website: "https://www.fairphone.com/" });
    const out = await runPipeline(run, { runs, pages, fetcher, steps: [frRepairStep, after] });
    expect(out.progress[0]).toEqual({ step: FR, status: "skipped", reason: "data.gouv.fr unreachable (HTTP 503)" });
    expect(out.progress[1]).toEqual({ step: "After", status: "done" });
  });

  it("an unparsable dataset list ⇒ skipped: repairability dataset could not be parsed (<url>)", async () => {
    const run = runs.create({ query: "x", brand: "Fairphone", website: "https://www.fairphone.com/" });
    const out = await runPipeline(run, { runs, pages, fetcher: new LogFetcher({ [firstPage()]: "<html>maintenance</html>" }), steps: [frRepairStep] });
    expect(out.progress[0]).toEqual({ step: FR, status: "skipped", reason: `repairability dataset could not be parsed (${firstPage()})` });
  });

  it("the brand's only open CSV cannot be parsed ⇒ skipped with that dataset's URL", async () => {
    const csv = "https://files.northwind-outdoor.example/broken.csv";
    const f = new LogFetcher({ [firstPage()]: syntheticApiPage([{ id: "a", publisher: "Northwind Outdoor", license: "lov2", csvUrl: csv }]), [csv]: "foo,bar\n1,2\n" });
    const run = runs.create({ query: "x", brand: "Northwind Outdoor", website: "https://www.northwind-outdoor.example/" });
    const out = await runPipeline(run, { runs, pages, fetcher: f, steps: [frRepairStep] });
    expect(out.progress[0]).toEqual({ step: FR, status: "skipped", reason: `repairability dataset could not be parsed (${csv})` });
  });

  it("non-durable brand ⇒ skipped with the repair axis's not-applicable reason; data.gouv.fr is not contacted", async () => {
    const f = new LogFetcher({});
    const run = runs.create({ query: "x", brand: "Quillmoor Foods", website: "https://www.quillmoor-foods.example/", entity: { industry: "food industry" } });
    const out = await runPipeline(run, { runs, pages, fetcher: f, steps: [frRepairStep] });
    expect(out.progress[0]).toMatchObject({ step: FR, status: "skipped", reason: expect.stringMatching(/^not applicable: the brand’s industry on Wikidata is “food industry”/) });
    expect(f.calls).toEqual([]);
  });

  it("an index signal replaces repair.no_repair_info_found (ADR-020)", async () => {
    const csv = "https://files.northwind-outdoor.example/ir.csv";
    const f = new LogFetcher({
      [firstPage()]: syntheticApiPage([{ id: "a", publisher: "Northwind Outdoor", license: "lov2", csvUrl: csv }]),
      [csv]: "id_modele,nom_modele,categorie_produit,nom_metteur_sur_le_marche,date_calcul,note_ir\n1,K,Bouilloire,Northwind Outdoor,2026-01-01,7.5\n",
    });
    const noInfo: Signal = { id: "repair-no_repair_info_found-x", axis: "repair", kind: "repair.no_repair_info_found", label: "l", weight_hint: 1, source_url: "https://www.northwind-outdoor.example/", fetched_at: "2026-10-20T00:00:00.000Z", excerpt: "Pages scanned: …", llm_used: false };
    const seed: Step = { id: "seed", label: () => "Seed", run: async () => ({ signals: [noInfo], could_not_check: [] }) };
    const run = runs.create({ query: "x", brand: "Northwind Outdoor", website: "https://www.northwind-outdoor.example/" });
    const out = await runPipeline(run, { runs, pages, fetcher: f, steps: [seed, frRepairStep] });
    expect(out.signals.map((s) => s.kind)).toEqual(["repair.fr_index_found"]);
    // Without an index signal, it stays.
    const none = await runPipeline(runs.create({ query: "y", brand: "Mammut", website: "https://www.mammut.com/" }), { runs, pages, fetcher: f, steps: [seed, frRepairStep] });
    expect(none.signals.map((s) => s.kind)).toEqual(["repair.no_repair_info_found"]);
  });
});
