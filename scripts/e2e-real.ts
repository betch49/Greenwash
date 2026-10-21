// Live end-to-end run against one real brand (PLAN Phase 9 deliverable 3, brief Section 10).
//
// Usage: npm run e2e:real -- <brand> [--website https://brand.example] [--prod] [--base http://127.0.0.1:3000]
//
// Without --base it starts `next dev` (or, with --prod, `next start` on the
// existing production build: run `npm run build` first) LIVE (GR_OFFLINE_FIXTURES unset) on a
// throw-away database (test-results/real.db), so every fetch goes to the real
// network through the robots guard, cache and rate limiter. With
// ANTHROPIC_API_KEY set the three AI steps call the real API; without it they
// are skipped ("LLM unavailable (no API key)") and the report uses the rule-based
// signals only.
//
// Flow (Playwright's Chromium): search the brand → confirm the first Wikidata card
// (or, when Wikidata gives no card or is unavailable and --website is given, paste
// the website) → wait for the run → open the report. Then it measures the cache:
// three GETs of /report/<id> and a second, identical search in a fresh browser
// context, which must be redirected to the same report id.
// Output: docs/phases/9-real-run.json (--prod) or 9-real-run-dev.json. Exit 1 when the second search is not
// re-served or takes ≥ 1 s.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const brand = args.find((a, i) => !a.startsWith("--") && !(i > 0 && ["--website", "--base"].includes(args[i - 1])));
const website = flag("website");
const externalBase = flag("base");
const prod = args.includes("--prod");
const PORT = 3127;
const BASE = externalBase ?? `http://127.0.0.1:${PORT}`;
const DB = join("test-results", "real.db");
const OUT = join("docs", "phases", prod ? "9-real-run.json" : "9-real-run-dev.json");
const ANALYSE = /\/analyse\/[0-9a-f-]{36}$/;
const REPORT = /\/report\/[0-9a-f-]{36}$/;

async function waitFor(url: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not answer at ${url} within ${ms} ms`);
}

function startServer(): ChildProcess {
  mkdirSync("test-results", { recursive: true });
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) rmSync(f, { force: true });
  const env: NodeJS.ProcessEnv = { ...process.env, GR_DB_PATH: DB, NEXT_TELEMETRY_DISABLED: "1" };
  delete env.GR_OFFLINE_FIXTURES;
  delete env.GR_FIXED_NOW;
  return spawn("npx", ["next", prod ? "start" : "dev", "-p", String(PORT), "-H", "127.0.0.1"], { env, stdio: ["ignore", "inherit", "inherit"], detached: true });
}

/** Search → first card, or the pasted website. Lands on /analyse or /report. */
async function enter(page: Page): Promise<"analyse" | "report"> {
  await page.goto(`${BASE}/`);
  await page.getByLabel("Brand name").fill(brand!);
  await page.getByLabel("Brand name").press("Enter");
  // Wikidata may answer 429 with Retry-After; the fetcher waits politely, so allow minutes.
  await page.waitForURL((u) => /^\/(analyse|confirm|report)/.test(u.pathname), { timeout: 300_000 });
  if (page.url().includes("/confirm")) {
    const card = page.locator("[data-candidate]").first().getByRole("button", { name: "Confirm" });
    if ((await card.count()) > 0) await card.click();
    else if (website) {
      await page.getByLabel("Brand website URL").fill(website);
      await page.getByRole("button", { name: "Continue with this website" }).click();
    } else throw new Error(`no Wikidata card for “${brand}” and no --website given: ${(await page.textContent("main"))?.slice(0, 300)}`);
    await page.waitForURL((u) => ANALYSE.test(u.pathname) || REPORT.test(u.pathname), { timeout: 300_000 });
  }
  return REPORT.test(new URL(page.url()).pathname) ? "report" : "analyse";
}

async function main() {
  if (!brand) throw new Error("usage: npm run e2e:real -- <brand> [--website https://…] [--prod] [--base http://…]");
  if (prod && !externalBase && !existsSync(join(".next", "BUILD_ID"))) throw new Error("no production build: run `npm run build` first");
  const server = externalBase ? undefined : startServer();
  const stop = () => {
    try {
      if (server?.pid) process.kill(-server.pid, "SIGTERM");
    } catch {
      // already gone
    }
  };
  let browser: Browser | undefined;
  try {
    await waitFor(`${BASE}/`, 120_000);
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
    const page = await browser.newPage();
    const t0 = Date.now();
    const first = await enter(page);
    const entryMs = Date.now() - t0;
    if (first === "report") throw new Error("the first search was already re-served from a stored report; use a fresh database");
    const runId = new URL(page.url()).pathname.split("/analyse/")[1];
    const tRun = Date.now();
    await page.getByTestId("run-status").and(page.locator('[data-status="done"], [data-status="failed"]')).waitFor({ timeout: 1_800_000 });
    const runMs = Date.now() - tRun;
    const status = await page.getByTestId("run-status").getAttribute("data-status");
    if (status !== "done") throw new Error(`run ${runId} ended with status ${status}`);
    await page.getByTestId("open-report").click();
    await page.waitForURL(REPORT);
    const reportId = new URL(page.url()).pathname.split("/report/")[1];

    const res = await fetch(`${BASE}/api/reports/${reportId}.json`);
    const report = (await res.json()) as {
      brand: string;
      website: string;
      score: number;
      label: string;
      confidence: number;
      ai_share: number;
      sources_count: number;
      signals_count: number;
      skipped: { step: string; reason: string }[];
      could_not_check: string[];
      axes: { id: string; status: string; subscore: number; signals: { kind: string; source_url: string }[] }[];
    };

    const reportGets: number[] = [];
    let header: string | null = null;
    for (let i = 0; i < 3; i++) {
      const t = Date.now();
      const r = await fetch(`${BASE}/report/${reportId}`);
      await r.text();
      reportGets.push(Date.now() - t);
      header = r.headers.get("x-gr-served-from");
    }

    // A second, identical search in a fresh context: must redirect to the stored report.
    const ctx = await browser.newContext();
    const again = await ctx.newPage();
    await again.goto(`${BASE}/`);
    await again.getByLabel("Brand name").fill(brand);
    const t2 = Date.now();
    await again.getByLabel("Brand name").press("Enter");
    await again.waitForURL((u) => /^\/(analyse|confirm|report)/.test(u.pathname), { timeout: 300_000 });
    let secondSearchMs = Date.now() - t2;
    if (again.url().includes("/confirm")) {
      // Card or pasted website: time only the step that consults the cache.
      const card = again.locator("[data-candidate]").first().getByRole("button", { name: "Confirm" });
      const t3 = Date.now();
      if ((await card.count()) > 0) await card.click();
      else {
        await again.getByLabel("Brand website URL").fill(website ?? "");
        await again.getByRole("button", { name: "Continue with this website" }).click();
      }
      await again.waitForURL((u) => ANALYSE.test(u.pathname) || REPORT.test(u.pathname));
      secondSearchMs = Date.now() - t3;
    }
    const reServedId = REPORT.test(new URL(again.url()).pathname) ? new URL(again.url()).pathname.split("/report/")[1] : null;

    const out = {
      brand,
      website_arg: website ?? null,
      base: BASE,
      server: externalBase ? "external" : `${prod ? "next start (production build)" : "next dev"}, live (GR_OFFLINE_FIXTURES unset)`,
      llm: process.env.ANTHROPIC_API_KEY ? "AnthropicLLM (key present)" : "none: no API key, AI steps skipped",
      run_at: new Date().toISOString(),
      run_id: runId,
      report_id: reportId,
      entry_ms: entryMs,
      run_ms: runMs,
      report: {
        brand: report.brand,
        website: report.website,
        score: report.score,
        label: report.label,
        confidence: report.confidence,
        ai_share: report.ai_share,
        sources_count: report.sources_count,
        signals_count: report.signals_count,
        axes: report.axes.map((a) => ({ id: a.id, status: a.status, subscore: a.subscore, signals: a.signals.map((s) => s.kind) })),
        skipped: report.skipped,
        could_not_check: report.could_not_check,
      },
      cache: {
        report_get_ms: reportGets,
        x_gr_served_from: header,
        second_search_ms: secondSearchMs,
        second_search_reserved_same_id: reServedId === reportId,
      },
    };
    writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
    console.log(JSON.stringify({ report_id: reportId, run_ms: runMs, score: report.score, ai_share: report.ai_share, cache: out.cache }, null, 2));
    console.log(`written ${OUT}`);
    if (reServedId !== reportId || secondSearchMs >= 1000) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
