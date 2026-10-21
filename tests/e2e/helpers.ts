import { expect, type APIRequestContext, type Page } from "@playwright/test";

export async function runCount(request: APIRequestContext): Promise<number> {
  const res = await request.get("/api/runs/count");
  if (!res.ok()) throw new Error(`runs count route returned ${res.status()}`);
  return (await res.json()).count as number;
}

/** Types a brand into the search box and presses Enter (no further navigation handling). */
export async function search(page: Page, brand: string): Promise<void> {
  await page.goto("/");
  const box = page.getByLabel("Brand name");
  await box.fill(brand);
  await box.press("Enter");
}

const ANALYSE = /\/analyse\/[0-9a-f-]{36}$/;
export const REPORT = /\/report\/[0-9a-f-]{36}$/;

/**
 * After a search or a pasted website: a fresh report for that website is
 * re-served (Phase 8, 8.5); tests that need a new run press "Re-run", as a user would.
 */
async function toAnalyse(page: Page): Promise<string> {
  await page.waitForURL((u) => ANALYSE.test(u.pathname) || REPORT.test(u.pathname));
  if (REPORT.test(new URL(page.url()).pathname)) {
    await page.getByRole("button", { name: "Re-run the analysis" }).click();
    await page.waitForURL(ANALYSE);
  }
  return new URL(page.url()).pathname.split("/analyse/")[1];
}

/** Search → (confirm the first card if asked) → a new run on /analyse. Returns the run id. */
export async function analyseBrand(page: Page, query: string): Promise<string> {
  await search(page, query);
  await page.waitForURL((u) => /^\/(analyse|confirm|report)/.test(u.pathname));
  if (page.url().includes("/confirm")) await page.locator("[data-candidate]").first().getByRole("button", { name: "Confirm" }).click();
  return toAnalyse(page);
}

/** "acme" (no Wikidata match) → paste a website → a new run on /analyse. Returns the run id. */
export async function analyseWebsite(page: Page, website: string, query = "acme"): Promise<string> {
  await search(page, query);
  await page.waitForURL(/\/confirm\?/);
  await page.getByLabel("Brand website URL").fill(website);
  await page.getByRole("button", { name: "Continue with this website" }).click();
  return toAnalyse(page);
}

/** Waits for the run on /analyse to finish and opens its report. Returns the report id. */
export async function openReport(page: Page): Promise<string> {
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await page.getByTestId("open-report").click();
  await page.waitForURL(REPORT);
  return new URL(page.url()).pathname.split("/report/")[1];
}
