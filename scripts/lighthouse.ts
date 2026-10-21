// Lighthouse accessibility run (PLAN Phase 8 deliverable 4, criterion 8.7).
//
// Usage: npm run build && npm run lighthouse
//
// Starts the production server offline (GR_OFFLINE_FIXTURES=1, pinned clock, a
// throw-away database), drives one fixture brand (Fairphone) through search →
// analyse → report with Playwright's Chromium to get a real report id, then runs
// Lighthouse (accessibility category only) through chrome-launcher on the same
// Chromium binary against /, /confirm (cards), /confirm (URL fallback),
// /report/[id] and /methodology. It also times a second visit of the report.
// Output: docs/phases/8-lighthouse.json. Exit 1 when any page scores below 90.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import { chromium } from "@playwright/test";

const PORT = Number(process.env.GR_LH_PORT || 3125);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = join("test-results", "lighthouse.db");
const OUT = join("docs", "phases", "8-lighthouse.json");
const MIN = 0.9;

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
  return spawn("npx", ["next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
    env: { ...process.env, GR_OFFLINE_FIXTURES: "1", GR_FIXED_NOW: "2026-10-20T00:00:00Z", GR_DB_PATH: DB, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
}

async function makeReport(executablePath: string): Promise<{ id: string; reserveMs: number }> {
  const browser = await chromium.launch({ executablePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/`);
    await page.getByLabel("Brand name").fill("fairphone");
    await page.getByLabel("Brand name").press("Enter");
    await page.waitForURL(/\/analyse\/[0-9a-f-]{36}$/);
    await page.getByTestId("open-report").click({ timeout: 60_000 });
    await page.waitForURL(/\/report\/[0-9a-f-]{36}$/);
    const id = new URL(page.url()).pathname.split("/report/")[1];
    const t0 = Date.now();
    const res = await fetch(`${BASE}/report/${id}`);
    const reserveMs = Date.now() - t0;
    if (res.headers.get("x-gr-served-from") !== "cache") throw new Error("report not marked as served from cache");
    return { id, reserveMs };
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!existsSync(join(".next", "BUILD_ID"))) throw new Error("no production build: run `npm run build` first");
  const executablePath = process.env.CHROME_PATH || chromium.executablePath();
  const server = startServer();
  const stop = () => {
    try {
      if (server.pid) process.kill(-server.pid, "SIGTERM");
    } catch {
      // already gone
    }
  };
  let chrome: chromeLauncher.LaunchedChrome | undefined;
  try {
    await waitFor(`${BASE}/`, 60_000);
    const { id, reserveMs } = await makeReport(executablePath);
    const pages = ["/", "/confirm?q=continental", "/confirm?q=acme", `/report/${id}`, "/methodology"];
    chrome = await chromeLauncher.launch({ chromePath: executablePath, chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"] });
    const results = [];
    for (const path of pages) {
      const runner = await lighthouse(`${BASE}${path}`, { port: chrome.port, onlyCategories: ["accessibility"], output: "json", logLevel: "error" });
      if (!runner) throw new Error(`lighthouse returned nothing for ${path}`);
      const lhr = runner.lhr;
      const score = lhr.categories.accessibility.score ?? 0;
      const failing = Object.values(lhr.audits)
        .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode === "binary")
        .map((a) => a.id);
      results.push({ path: path.replace(id, "[id]"), score: Math.round(score * 100), failing });
      console.log(`${path}: accessibility ${Math.round(score * 100)}${failing.length ? ` (failing: ${failing.join(", ")})` : ""}`);
    }
    const out = {
      tool: "lighthouse (accessibility category)",
      lighthouse_version: (await import("lighthouse/package.json", { with: { type: "json" } })).default.version,
      chrome: executablePath,
      server: "next start (production build), GR_OFFLINE_FIXTURES=1",
      run_at: new Date().toISOString(),
      report_reserve_ms: reserveMs,
      minimum: Math.round(MIN * 100),
      pages: results,
    };
    writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`report re-served in ${reserveMs} ms; written ${OUT}`);
    if (results.some((r) => r.score < MIN * 100)) process.exitCode = 1;
  } finally {
    if (chrome) await chrome.kill();
    stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
