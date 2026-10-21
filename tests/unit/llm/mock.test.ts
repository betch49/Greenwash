// PLAN criterion 7.5: MockLLM with no fixture file ⇒ every call returns an empty valid result and the pipeline completes.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import { fixtureFileName, inputHash, stableStringify } from "@/lib/llm/client";
import { MockLLM } from "@/lib/llm/mock";
import { ExtractOutputSchema } from "@/lib/llm/extract";
import { runPipeline } from "@/lib/pipeline/run";
import { OfflineFetcher } from "../helpers/brands";
import { tempDb } from "../helpers/db";
import { FakeLLM } from "./fake";

const NOW = () => new Date("2026-10-20T12:00:00Z");
const dirs: string[] = [];
const emptyDir = () => {
  const d = mkdtempSync(join(tmpdir(), "gr-llm-"));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("MockLLM (7.5)", () => {
  it("fixture name = <name>-<sha1(input).slice(0,12)>.json, independent of key order", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(fixtureFileName("extract", { b: 1, a: 2 })).toBe(fixtureFileName("extract", { a: 2, b: 1 }));
    expect(fixtureFileName("summary", { a: 1 })).toBe(`summary-${inputHash({ a: 1 }).slice(0, 12)}.json`);
  });

  it("no fixture ⇒ no output, never a throw; a fixture ⇒ its output", async () => {
    const mock = new MockLLM(emptyDir());
    const req = { name: "extract" as const, instructions: "", input: { page_url: "https://a.example/", text: "x", allowed_urls: [] }, schema: ExtractOutputSchema };
    expect(await mock.call(req)).toEqual({ output: undefined, used_fixture: false });
    expect(mock.missing).toEqual([mock.pathFor(req)]);
    const fixtures = new MockLLM(join("fixtures", "llm"));
    expect(existsSync(join("fixtures", "llm"))).toBe(true);
    expect(fixtures.unavailable).toBeNull();
  });

  it("with no fixture files, the whole pipeline completes: LLM steps run, return nothing, change nothing", async () => {
    const env = tempDb();
    try {
      const runs = new RunsRepo(env.db);
      const base = { runs, pages: new RunPagesRepo(env.db), fetcher: new OfflineFetcher(), now: NOW };
      const mk = () => runs.create({ query: "northwind outdoor", brand: "Northwind Outdoor Ltd.", website: "https://www.northwind-outdoor.example" });
      const without = await runPipeline(mk(), base);
      const withMock = await runPipeline(mk(), { ...base, llm: new MockLLM(emptyDir()) });
      expect(withMock.status).toBe("done");
      expect(withMock.signals).toEqual(without.signals);
      expect(withMock.report!.score).toBe(without.report!.score);
      expect(withMock.report!.ai_share).toBe(0);
      expect(withMock.report!.summary).toBeUndefined();
      const calls = withMock.report!.llm_calls;
      expect(new Set(calls.map((c) => c.name))).toEqual(new Set(["extract", "classify-diff", "summary"]));
      expect(calls.every((c) => c.status === "empty" && !c.used_fixture)).toBe(true);
      expect(withMock.progress.find((p) => p.step === "Proposing candidate claims (AI)")!.status).toBe("done");
      expect(withMock.progress.find((p) => p.step === "Writing the plain-English summary (AI)")).toMatchObject({ status: "skipped" });
    } finally {
      env.cleanup();
    }
  });

  it("no key outside offline mode ⇒ marked unavailable: the LLM steps say 'skipped: LLM unavailable (no API key)' and the report still builds", async () => {
    const env = tempDb();
    try {
      const runs = new RunsRepo(env.db);
      const run = runs.create({ query: "fairphone", brand: "Fairphone", website: "https://www.fairphone.com/" });
      const out = await runPipeline(run, { runs, pages: new RunPagesRepo(env.db), fetcher: new OfflineFetcher(), now: NOW, llm: new MockLLM(emptyDir(), { unavailable: "no API key" }) });
      expect(out.status).toBe("done");
      const ai = out.progress.filter((p) => p.step.endsWith("(AI)"));
      expect(ai.map((p) => [p.step, p.status, p.reason])).toEqual([
        ["Proposing candidate claims (AI)", "skipped", "LLM unavailable (no API key)"],
        ["Classifying archived changes (AI)", "skipped", "LLM unavailable (no API key)"],
        ["Writing the plain-English summary (AI)", "skipped", "LLM unavailable (no API key)"],
      ]);
      expect(out.report!.llm_calls).toEqual([]);
      expect(out.could_not_check.filter((c) => c.startsWith("AI-assisted steps"))).toHaveLength(1);
    } finally {
      env.cleanup();
    }
  });

  it("with a recorder (GR_RECORD_LLM=1 and a key), a missing fixture is fetched once and written", async () => {
    const dir = emptyDir();
    const real = new FakeLLM(() => ({ claims: [] }));
    const mock = new MockLLM(dir, { recorder: real });
    const req = { name: "extract" as const, instructions: "", input: { page_url: "https://a.example/", text: "x", allowed_urls: [] }, schema: ExtractOutputSchema };
    expect(await mock.call(req)).toEqual({ output: { claims: [] }, used_fixture: false });
    const written = JSON.parse(readFileSync(mock.pathFor(req), "utf8"));
    expect(written).toMatchObject({ name: "extract", input_sha1: inputHash(req.input), output: { claims: [] } });
    expect(await mock.call(req)).toEqual({ output: { claims: [] }, used_fixture: true });
    expect(real.requests).toHaveLength(1);
  });
});
