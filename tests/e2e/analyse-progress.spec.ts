import { expect, test, type APIRequestContext } from "@playwright/test";
import { analyseBrand, analyseWebsite } from "./helpers";

async function runStatus(request: APIRequestContext, id: string): Promise<{ status: string; progress: { step: string; status: string; reason?: string }[] }> {
  const res = await request.get(`/api/runs/${id}`);
  expect(res.ok()).toBe(true);
  return res.json();
}


test("2.6 after confirm, /analyse lists 'Discovering pages' and 'Fetching current pages' and both reach done", async ({ page }) => {
  // Mammut, the real outdoor-apparel capture. Plain "mammut" finds the extinct genus first on Wikidata.
  await analyseBrand(page, "mammut sports group");

  const progress = page.getByTestId("progress");
  await expect(progress.locator('[data-step="Discovering pages"]')).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(progress.locator('[data-step="Fetching current pages"]')).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  // Phase 3: the rule-based claim and evidence steps run on the fetched pages.
  await expect(progress.locator('[data-step="Checking claim language"]')).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(progress.locator('[data-step="Checking published evidence"]')).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done");

  // Fetched pages are listed with their fetch date (the capture date).
  const pages = page.getByTestId("pages").locator("li");
  expect(await pages.count()).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId("pages")).toContainText("Responsibility | Mammut");
  await expect(page.getByTestId("pages")).toContainText("fetched 2026-10-20");
});

test("2.4 a robots-disallowed page is shown as skipped, not hidden (fictional test-only fixture)", async ({ page }) => {
  await analyseWebsite(page, "https://www.northwind-outdoor.example");

  const progress = page.getByTestId("progress");
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(progress.getByText("skipped: robots.txt disallows https://www.northwind-outdoor.example/stories/archive/our-footprint-2019/")).toBeVisible();
  await expect(page.getByTestId("pages")).toContainText("Our Footprint - Northwind Outdoor");
  // Brief Section 8 "say so" (ADR-016): the could-not-check line states what the Wayback Machine gave instead.
  await expect(page.getByTestId("could-not-check")).toContainText(
    "https://www.northwind-outdoor.example/stories/archive/our-footprint-2019/ (robots.txt does not allow us to fetch it; the Wayback Machine has no archived copy from 2019–2026, so nothing on it was checked).",
  );
});

test("2.6 a reload does not start the pipeline twice", async ({ page, request }) => {
  const id = await analyseBrand(page, "fairphone");
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
  const id = await analyseWebsite(page, "https://www.oatly.com/");

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

test("5.9 /analyse shows the ASA, JDP and repair steps, each ending in done or skipped: … (offline)", async ({ page }) => {
  const NEW_STEPS = ["Checking ASA (UK) rulings", "Checking JDP (France) decisions", "Checking repair information"];
  for (const query of ["fairphone", "oatly"]) {
    await analyseBrand(page, query);
    await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    const progress = page.getByTestId("progress");
    for (const step of NEW_STEPS) {
      const row = progress.locator(`[data-step="${step}"]`);
      await expect(row, `${query}: ${step}`).toHaveCount(1);
      expect(["done", "skipped"]).toContain(await row.getAttribute("data-status"));
      if ((await row.getAttribute("data-status")) === "skipped") await expect(row).toContainText("skipped: ");
    }
    if (query === "fairphone") {
      await expect(progress.locator(`[data-step="Checking repair information"]`)).toHaveAttribute("data-status", "done");
    } else {
      // Oatly: the real ASA ruling is found; the repair axis is not applicable to a drinks brand, and the report says so.
      await expect(progress.locator(`[data-step="Checking ASA (UK) rulings"]`)).toHaveAttribute("data-status", "done");
      await expect(progress.locator(`[data-step="Checking repair information"]`)).toContainText("skipped: not applicable");
      await expect(page.getByTestId("could-not-check")).toContainText("Repair and ownership: not applicable");
      await expect(page.getByTestId("could-not-check")).toContainText("Regulator rulings: only the UK ASA and the French JDP were searched");
    }
  }
});

test("12.8 /analyse shows 'Checking the French repairability index': done for Fairphone, skipped (not applicable) for Oatly (offline)", async ({ page }) => {
  const STEP = "Checking the French repairability index";
  for (const query of ["fairphone", "oatly"]) {
    await analyseBrand(page, query);
    await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    const row = page.getByTestId("progress").locator(`[data-step="${STEP}"]`);
    await expect(row, query).toHaveCount(1);
    if (query === "fairphone") await expect(row).toHaveAttribute("data-status", "done");
    else await expect(row).toContainText("skipped: not applicable");
  }
});
