// Writes the offline LLM fixtures (PLAN Phase 7 deliverable 7) for the fixture
// brands, by running the offline pipeline with a stand-in "author" in place of
// the model. No ANTHROPIC_API_KEY was available in the build environment, so
// these files are HAND-AUTHORED STAND-INS, not model output; each file says so
// in its `source` field. With a key, record real ones instead:
//   GR_OFFLINE_FIXTURES=1 GR_RECORD_LLM=1 ANTHROPIC_API_KEY=… (delete fixtures/llm first)
//
// Usage: npm run author:llm
//
// The author is deliberately plain:
//   extract        ⇒ the page sentences a claim rule matches (as a good extractor
//                    would propose them) plus up to two sustainability-topic
//                    sentences no rule matches (which the rule engine must drop);
//   classify-diff  ⇒ a fixed answer per removed sentence (CLASSIFY below; default "unsure");
//   summary        ⇒ a template over the report's own receipts, citing one fetched URL.
// Fixture names are `<name>-<sha1(input).slice(0,12)>.json`, so any change to a
// page fixture or to an input builder means re-running this script.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify } from "../src/lib/claims/engine";
import { splitSentences } from "../src/lib/claims/split";
import { findForbidden } from "../src/lib/copy/forbidden";
import { openDb } from "../src/lib/db/client";
import { RunOutputsRepo } from "../src/lib/db/run-outputs-repo";
import { RunPagesRepo } from "../src/lib/db/run-pages-repo";
import { RunsRepo } from "../src/lib/db/runs-repo";
import { loadBrandFixtures } from "../src/lib/fetch/brand-fixtures";
import { FixtureFetcher, combineMaps } from "../src/lib/fetch/fixture-fetcher";
import { loadSourceFixtures } from "../src/lib/fetch/source-fixtures";
import { fixtureFileName, inputHash, type LLMClient, type LLMRequest, type LLMResponse } from "../src/lib/llm/client";
import { LLM_CONFIG } from "../src/lib/llm/config";
import type { ClassifyInput } from "../src/lib/llm/classify-diff";
import type { ExtractInput } from "../src/lib/llm/extract";
import type { SummaryInput } from "../src/lib/llm/summary";
import { runPipeline } from "../src/lib/pipeline/run";

const ROOT = "fixtures";
const OUT = LLM_CONFIG.fixturesDir;
const NOW = () => new Date("2026-10-20T12:00:00Z");
const BRANDS = ["mammut", "fairphone", "oatly", "northwind", "quillmoor"];
const SOURCE = "hand-authored stand-in, not model output (no ANTHROPIC_API_KEY in the build environment); written by scripts/author-llm-fixtures.ts";

/** Diff classifications for the fictional brands' removals (ADR-011 fixtures). */
const CLASSIFY: Record<string, string> = {
  "Every Northwind jacket is climate neutral, so you can wear it with a clear conscience.": "claim_removed",
  "Our dyes are eco-friendly and kind to rivers.": "unsure",
};

const TOPIC = /\b(sustainab\w*|climate|planet|environment\w*|emission\w*|carbon|recycl\w*|renewable)\b/i;
const MAX_PROPOSALS = 10;

function authorExtract(input: ExtractInput) {
  const sentences = splitSentences(input.text);
  const claims: { sentence: string; kind_hint: string }[] = [];
  let topical = 0;
  sentences.forEach((s, i) => {
    if (claims.length >= MAX_PROPOSALS) return;
    const m = classify(s, sentences[i + 1]);
    if (m.length > 0) claims.push({ sentence: s, kind_hint: m[0].ruleId });
    else if (topical < 2 && TOPIC.test(s) && s.split(/\s+/).length >= 6) {
      topical++;
      claims.push({ sentence: s, kind_hint: "other" });
    }
  });
  return { claims };
}

function authorClassify(input: ClassifyInput) {
  return { classification: CLASSIFY[input.removed_sentence] ?? "unsure" };
}

const words = (s: string, n: number) => {
  const w = s.split(/\s+/);
  return w.length <= n ? s : `${w.slice(0, n).join(" ")} …`;
};

function authorSummary(input: SummaryInput) {
  const scored = input.axes.filter((a) => a.status === "scored" && a.signals.length > 0);
  const risk = scored.flatMap((a) => a.signals).find((s) => /unsupported claim|claim removed|ruling found|risk signal/i.test(s.label) && findForbidden(s.excerpt).length === 0);
  const removal = input.removals.find((r) => findForbidden(r.sentence).length === 0);
  const parts = [
    `${input.brand}: ${input.label.toLowerCase()} (score ${input.score}, confidence ${input.confidence}%). ${input.basis}`,
    risk ? `One example: “${words(risk.excerpt, 18)}” (${risk.label.split(":")[0].split(" (")[0].toLowerCase()}, ${risk.source_url}).` : "",
    removal ? `Claim removed between ${removal.from} and ${removal.to}: “${words(removal.sentence, 14)}”.` : "",
    input.could_not_check.length > 0 ? `${input.could_not_check.length} things could not be checked; they are listed in the report.` : "",
  ].filter(Boolean);
  const summary = parts.join(" ");
  return { summary, cited_urls: risk ? [risk.source_url] : [] };
}

class AuthoringLLM implements LLMClient {
  readonly kind = "mock" as const;
  readonly unavailable = null;
  readonly written: string[] = [];

  async call(req: LLMRequest): Promise<LLMResponse> {
    const output =
      req.name === "extract" ? authorExtract(req.input as ExtractInput) : req.name === "classify-diff" ? authorClassify(req.input as ClassifyInput) : authorSummary(req.input as SummaryInput);
    const file = join(OUT, fixtureFileName(req.name, req.input));
    writeFileSync(file, `${JSON.stringify({ name: req.name, input_sha1: inputHash(req.input), source: SOURCE, output }, null, 2)}\n`);
    this.written.push(file);
    return { output, used_fixture: true };
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (f.endsWith(".json")) rmSync(join(OUT, f));
  const brands = loadBrandFixtures(ROOT);
  const sources = loadSourceFixtures(ROOT);
  const fetcher = new FixtureFetcher(ROOT, combineMaps(brands.map, sources.map), (url) => brands.capturedAt(url) ?? sources.capturedAt(url) ?? "1970-01-01T00:00:00.000Z");
  const dir = mkdtempSync(join(tmpdir(), "gr-author-"));
  const db = openDb(join(dir, "author.db"));
  try {
    for (const slug of BRANDS) {
      const meta = JSON.parse(readFileSync(join(ROOT, "brands", slug, "meta.json"), "utf8")) as { query: string; website: string; entity: { id: string | null; name: string } };
      const runs = new RunsRepo(db);
      const run = runs.create({ query: meta.query, brand: meta.entity.name, website: meta.website, wikidataId: meta.entity.id, entity: meta.entity });
      const llm = new AuthoringLLM();
      const out = await runPipeline(run, { runs, pages: new RunPagesRepo(db), outputs: new RunOutputsRepo(db), fetcher, llm, now: NOW });
      console.log(`${slug}: ${out.status}, ${llm.written.length} fixtures, score ${out.report?.score}, ai_share ${out.report?.ai_share.toFixed(3)}, summary ${out.report?.summary ? "ok" : "unavailable"}`);
    }
  } finally {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
