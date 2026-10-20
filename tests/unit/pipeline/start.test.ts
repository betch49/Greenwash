import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import type { FetchedPage } from "@/lib/discover/fetch-pages";
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
});
