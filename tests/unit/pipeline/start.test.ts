import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import type { FetchedPage } from "@/lib/discover/fetch-pages";
import { skippedReason } from "@/lib/copy/wording";
import { inflightRun, settleInterrupted } from "@/lib/pipeline/start";
import { tempDb } from "../helpers/db";

describe("run lifecycle", () => {
  let env: ReturnType<typeof tempDb>;
  beforeEach(() => {
    env = tempDb();
  });
  afterEach(() => env.cleanup());

  it("claimStart is idempotent: exactly one caller starts a pending run", () => {
    const runs = new RunsRepo(env.db);
    const run = runs.create({ query: "x", brand: "X", website: "https://x.example" });
    expect(run.status).toBe("pending");
    expect(runs.claimStart(run.id)).toBe(true);
    expect(runs.claimStart(run.id)).toBe(false);
    expect(runs.get(run.id)!.status).toBe("running");
    runs.setStatus(run.id, "done");
    expect(runs.claimStart(run.id)).toBe(false);
    expect(runs.claimStart("no-such-run")).toBe(false);
  });

  it("stores and replaces a run's pages in order", () => {
    const repo = new RunPagesRepo(env.db);
    const page = (url: string): FetchedPage => ({
      url,
      via: "sitemap",
      title: "T",
      text: "some text",
      wordCount: 2,
      links: [{ href: "https://x.example/r.pdf", text: "report", region: "content" }],
      fetchedAt: "2026-10-20T00:00:00.000Z",
      source: "fixture",
      contentHash: url,
    });
    repo.replace("r1", [page("https://x.example/b"), page("https://x.example/a")]);
    expect(repo.list("r1").map((p) => p.url)).toEqual(["https://x.example/b", "https://x.example/a"]);
    expect(repo.list("r1")[0].links[0].region).toBe("content");
    repo.replace("r1", [page("https://x.example/c")]);
    expect(repo.list("r1").map((p) => p.url)).toEqual(["https://x.example/c"]);
    expect(repo.list("r2")).toEqual([]);
  });

  it("a run left 'running' with no pipeline in this process is shown as failed with a skipped reason (ADR-013)", () => {
    const runs = new RunsRepo(env.db);
    const run = runs.create({ query: "x", brand: "X", website: "https://x.example" });
    expect(runs.claimStart(run.id)).toBe(true);
    runs.setProgress(run.id, [
      { step: "Discovering pages", status: "done" },
      { step: "Fetching current pages", status: "running" },
    ]);
    const view = settleInterrupted(runs.get(run.id)!, runs, () => false);
    const interrupted = "analysis interrupted (server restarted); search again to retry";
    expect(view.status).toBe("failed");
    expect(view.progress).toEqual([
      { step: "Discovering pages", status: "done" },
      { step: "Fetching current pages", status: "skipped", reason: interrupted },
    ]);
    // Persisted, so the API and a reload show the same thing.
    expect(runs.get(run.id)!.status).toBe("failed");
    expect(runs.get(run.id)!.progress).toEqual(view.progress);
    expect(skippedReason(view.progress[1].reason!)).toBe(`skipped: ${interrupted}`);
  });

  it("a claimed run that never recorded a step gets a 'Pipeline' skipped line", () => {
    const runs = new RunsRepo(env.db);
    const run = runs.create({ query: "x", brand: "X", website: "https://x.example" });
    runs.claimStart(run.id);
    const view = settleInterrupted(runs.get(run.id)!, runs, () => false);
    expect(view.status).toBe("failed");
    expect(view.progress).toEqual([
      { step: "Pipeline", status: "skipped", reason: "analysis interrupted (server restarted); search again to retry" },
    ]);
  });

  it("a run this process is executing, and finished or pending runs, are left alone", () => {
    const runs = new RunsRepo(env.db);
    const running = runs.create({ query: "x", brand: "X", website: "https://x.example" });
    runs.claimStart(running.id);
    runs.setProgress(running.id, [{ step: "Discovering pages", status: "running" }]);
    const live = settleInterrupted(runs.get(running.id)!, runs, (id) => id === running.id);
    expect(live.status).toBe("running");
    expect(runs.get(running.id)!.progress).toEqual([{ step: "Discovering pages", status: "running" }]);

    const pending = runs.create({ query: "y", brand: "Y", website: "https://y.example" });
    expect(settleInterrupted(pending, runs, () => false).status).toBe("pending");
    const done = runs.create({ query: "z", brand: "Z", website: "https://z.example" });
    runs.setStatus(done.id, "done");
    expect(settleInterrupted(runs.get(done.id)!, runs, () => false).status).toBe("done");
  });

  it("by default, 'in flight' means this process's pipeline map (inflightRun)", () => {
    const runs = new RunsRepo(env.db);
    const run = runs.create({ query: "x", brand: "X", website: "https://x.example" });
    runs.claimStart(run.id);
    expect(inflightRun(run.id)).toBeUndefined();
    expect(settleInterrupted(runs.get(run.id)!, runs).status).toBe("failed");
  });
});
