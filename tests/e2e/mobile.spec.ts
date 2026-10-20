import { devices, expect, test, type Page } from "@playwright/test";
import { search } from "./helpers";

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
  await search(page, "fairphone");
  await page.waitForURL(/\/analyse\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await noHorizontalOverflow(page);
});
