import { expect, test, type APIRequestContext } from "@playwright/test";
import { search } from "./helpers";

async function runStatus(request: APIRequestContext, id: string): Promise<{ status: string; progress: { step: string; status: string; reason?: string }[] }> {
  const res = await request.get(`/api/runs/${id}`);
  expect(res.ok()).toBe(true);
  return res.json();
}

const runIdOf = (url: string) => url.split("/analyse/")[1];

test("2.6 after confirm, /analyse lists 'Discovering pages' and 'Fetching current pages' and both reach done", async ({ page }) => {
  // Mammut, the real outdoor-apparel capture. Plain "mammut" finds the extinct genus first on Wikidata.
  await search(page, "mammut sports group");
  await page.waitForURL(/\/(analyse|confirm)/);
  if (page.url().includes("/confirm")) {
    await page.locator("[data-candidate]").first().getByRole("button", { name: "Confirm" }).click();
  }
  await page.waitForURL(/\/analyse\/[0-9a-f-]{36}$/);

  const progress = page.getByTestId("progress");
  await expect(progress.locator('[data-step="Discovering pages"]')).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(progress.locator('[data-step="Fetching current pages"]')).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done");

  // Fetched pages are listed with their fetch date (the capture date).
  const pages = page.getByTestId("pages").locator("li");
  expect(await pages.count()).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId("pages")).toContainText("Responsibility | Mammut");
  await expect(page.getByTestId("pages")).toContainText("fetched 2026-10-20");
});

test("2.4 a robots-disallowed page is shown as skipped, not hidden (fictional test-only fixture)", async ({ page }) => {
  await search(page, "acme");
  await page.waitForURL(/\/confirm\?/);
  await page.getByLabel("Brand website URL").fill("https://www.northwind-outdoor.example");
  await page.getByRole("button", { name: "Continue with this website" }).click();
  await page.waitForURL(/\/analyse\/[0-9a-f-]{36}$/);

  const progress = page.getByTestId("progress");
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(progress.getByText("skipped: robots.txt disallows https://www.northwind-outdoor.example/stories/archive/our-footprint-2019/")).toBeVisible();
  await expect(page.getByTestId("pages")).toContainText("Our Footprint - Northwind Outdoor");
});

test("2.6 a reload does not start the pipeline twice", async ({ page, request }) => {
  await search(page, "fairphone");
  await page.waitForURL(/\/analyse\/[0-9a-f-]{36}$/);
  const id = runIdOf(page.url());
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  const before = await runStatus(request, id);
  await page.reload();
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done");
  await page.waitForTimeout(1500);
  expect(await runStatus(request, id)).toEqual(before);
  expect(before.progress.filter((p) => p.step === "Discovering pages")).toHaveLength(1);
});

test("2.6 a GET of /analyse never starts the pipeline; only the explicit Start action does (no JavaScript)", async ({ browser, request }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await search(page, "acme");
  await page.waitForURL(/\/confirm\?/);
  await page.getByLabel("Brand website URL").fill("https://www.oatly.com/");
  await page.getByRole("button", { name: "Continue with this website" }).click();
  await page.waitForURL(/\/analyse\/[0-9a-f-]{36}$/);
  const id = runIdOf(page.url());

  // Rendering the page (GET) and polling the API (GET) leave the run pending.
  await page.reload();
  await page.waitForTimeout(1500);
  expect((await runStatus(request, id)).status).toBe("pending");
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "pending");

  await page.getByRole("button", { name: "Start analysis" }).click();
  await expect
    .poll(async () => (await runStatus(request, id)).status, { timeout: 30_000 })
    .toBe("done");
  const done = await runStatus(request, id);
  expect(done.progress.slice(0, 2).map((p) => [p.step, p.status])).toEqual([
    ["Discovering pages", "done"],
    ["Fetching current pages", "done"],
  ]);
  await context.close();
});
