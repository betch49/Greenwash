import { devices, expect, test, type Page } from "@playwright/test";
import { analyseBrand, search } from "./helpers";
import { reportFor } from "./report-helpers";

// iPhone 12 profile, run in Chromium (only Chromium is installed in the build env).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...iPhone12 } = devices["iPhone 12"];
test.use(iPhone12);

async function noHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(innerWidth).toBeLessThanOrEqual(390);
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

test("1.9 search page has no horizontal overflow on a phone", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Brand name")).toBeVisible();
  await noHorizontalOverflow(page);
});

test("1.9 confirm cards have no horizontal overflow on a phone", async ({ page }) => {
  await search(page, "continental");
  await expect(page.locator("[data-candidate]").first()).toBeVisible();
  await noHorizontalOverflow(page);
});

test("1.9 URL fallback has no horizontal overflow on a phone", async ({ page }) => {
  await search(page, "acme");
  await expect(page.getByLabel("Brand website URL")).toBeVisible();
  await noHorizontalOverflow(page);
});

test("2.6 analyse page with progress and page list has no horizontal overflow on a phone", async ({ page }) => {
  await analyseBrand(page, "fairphone");
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await noHorizontalOverflow(page);
});

test("6.7 /methodology has no horizontal overflow on a phone (wide tables scroll inside their box)", async ({ page }) => {
  await page.goto("/methodology");
  await expect(page.getByTestId("axis-weights")).toBeVisible();
  await noHorizontalOverflow(page);
});

test("8.6 report page on a phone: no horizontal scroll and all four axes visible", async ({ page }) => {
  await reportFor(page, "mammut sports group");
  await expect(page.getByTestId("headline")).toBeVisible();
  const axes = page.locator("section[data-axis]");
  await expect(axes).toHaveCount(4);
  for (const axis of await axes.all()) {
    await axis.scrollIntoViewIfNeeded();
    await expect(axis).toBeVisible();
  }
  await noHorizontalOverflow(page);
  await page.screenshot({ path: "test-results/report-phone-mammut.png", fullPage: true });
});

test("8.6 report page on a phone in dark mode: no horizontal scroll (Fairphone)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await reportFor(page, "fairphone");
  await noHorizontalOverflow(page);
});
