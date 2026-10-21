// Validation harness (PLAN Phase 10 deliverable 3, ADR-025).
//
// Usage: npm run validate -- [--mode offline|live] [--brands a,b] [--out docs/validation] [--tag name] [--db path]
//
// offline (default): GR_OFFLINE_FIXTURES=1 services (FixtureFetcher + MockLLM), a throw-away
//   database, the pinned fixture clock; runs only the ground-truth brands that have a brand
//   fixture (`fixture` in fixtures/validation/ground-truth.json). No network.
// live: the app's live services (robots guard, 1 request per second per host, the SQLite fetch
//   cache in data/validation.db, real clock); every selected brand, continuing past failures.
//   Without ANTHROPIC_API_KEY the AI steps are skipped, as in the app.
//
// Writes docs/validation/results-<date>-<mode>[-<tag>].json and regenerates docs/validation/RESULTS.md.
// Writes nothing else in the repository. Ground-truth labels are evaluation only: the pipeline
// receives the brand name, website and Wikidata entity, never the label.
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/lib/db/client";
import { RunsRepo } from "../src/lib/db/runs-repo";
import { selectLLM } from "../src/lib/llm/select";
import { buildFetcher, pipelineClock } from "../src/lib/services";
import { WEIGHTS } from "../src/lib/score/weights";
import { loadGroundTruth } from "../src/lib/validation/ground-truth";
import { runHarness, type Mode } from "../src/lib/validation/harness";
import { summarise, writeResults } from "../src/lib/validation/report";

/** The offline clock when GR_FIXED_NOW is not set: the fixture capture week, so offline results are reproducible. */
const OFFLINE_NOW = "2026-10-21T12:00:00Z";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const mode = (flag("mode") ?? "offline") as Mode;
if (mode !== "offline" && mode !== "live") {
  console.error("usage: npm run validate -- [--mode offline|live] [--brands a,b] [--out docs/validation] [--tag name]");
  process.exit(2);
}
const out = flag("out") ?? join("docs", "validation");
const tag = flag("tag");
const only = flag("brands")?.split(",").map((s) => s.trim()).filter(Boolean);

const git = (cmd: string) => {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

async function main() {
  const gt = loadGroundTruth();
  const selected = only ? gt.entries.filter((e) => only.includes(e.slug)) : gt.entries;
  if (only) {
    const unknown = only.filter((s) => !gt.entries.some((e) => e.slug === s));
    if (unknown.length) throw new Error(`unknown ground-truth slug(s): ${unknown.join(", ")}`);
  }

  const env: Record<string, string | undefined> = { ...process.env };
  if (mode === "offline") {
    env.GR_OFFLINE_FIXTURES = "1";
    env.GR_FIXED_NOW ??= OFFLINE_NOW;
    process.env.GR_OFFLINE_FIXTURES = "1";
  } else {
    delete env.GR_OFFLINE_FIXTURES;
    delete process.env.GR_OFFLINE_FIXTURES;
  }
  const tmp = mode === "offline" ? mkdtempSync(join(tmpdir(), "gr-validate-")) : null;
  const dbPath = flag("db") ?? (tmp ? join(tmp, "validate.db") : join("data", "validation.db"));
  const db = openDb(dbPath);
  const offline = mode === "offline";
  const llm = selectLLM(env);
  const services = { db, runs: new RunsRepo(db), fetcher: buildFetcher(db, offline), llm, now: pipelineClock(env) };
  const llmText = offline
    ? "MockLLM over recorded fixtures (fixtures/llm); a call with no fixture returns nothing"
    : llm.kind === "mock"
      ? "none (no ANTHROPIC_API_KEY): the three AI steps are skipped, rule-based signals only"
      : "AnthropicLLM (key present)";

  try {
    const results = await runHarness(selected, { mode, services, log: (l) => console.log(l) });
    const notes: string[] = [];
    if (only) notes.push(`Selected ${selected.length} of ${gt.entries.length} ground-truth entries with --brands; the other ${gt.entries.length - selected.length} were not run in this ${mode} run.`);
    if (offline) notes.push(`Offline: brands without a recorded brand fixture are not run; clock pinned to ${env.GR_FIXED_NOW}.`);
    const waybackSkipped = results.filter((r) => r.steps.some((s) => /wayback|archive|snapshots/i.test(s.step) && s.status === "skipped")).length;
    if (waybackSkipped) notes.push(`The Wayback step was skipped for ${waybackSkipped} brand(s) (see the coverage table): their track-record axis has no archived-claim data.`);
    const summary = summarise(gt, selected, results, {
      mode,
      generatedAt: new Date(),
      commit: git("rev-parse --short HEAD") || "unknown",
      commitDirty: git("status --porcelain") !== "",
      weightsVersion: WEIGHTS.version,
      llm: llmText,
      notes,
    });
    const paths = writeResults(out, summary, tag);
    console.log(`AUC ${summary.stats.auc ?? "n/a"} (flagged ${summary.n_flagged_ran}, well-rated ${summary.n_well_rated_ran}); ran ${summary.n_ran}, failed ${summary.n_failed}, not run ${summary.n_not_run}`);
    if (summary.partial) console.log(summary.partial);
    console.log(`written ${paths.json} and ${paths.md}`);
  } finally {
    db.$client.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
