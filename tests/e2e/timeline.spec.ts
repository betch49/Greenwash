import { expect, test, type Page } from "@playwright/test";
import { search } from "./helpers";

// Both brands are fictional, test-only fixtures on .example domains with hand-built Wayback histories (ADR-011).
async function analyseWebsite(page: Page, website: string) {
  await search(page, "acme");
  await page.waitForURL(/\/confirm\?/);
  await page.getByLabel("Brand website URL").fill(website);
  await page.getByRole("button", { name: "Continue with this website" }).click();
  await page.waitForURL(/\/analyse\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
}

test("4.7 the removed-claim fixture shows a timeline with the year the claim disappeared", async ({ page }) => {
  await analyseWebsite(page, "https://www.northwind-outdoor.example");

  // The server clock is pinned to 2026-10-20 (GR_FIXED_NOW in playwright.config.ts); literal label on purpose.
  await expect(page.getByTestId("progress").locator('[data-step="Pulling 2019–2026 snapshots"]')).toHaveAttribute("data-status", "done");

  const timeline = page.getByTestId("timeline");
  await expect(timeline.getByRole("heading", { name: "Timeline of archived claims" })).toBeVisible();
  const footprint = timeline.locator('[data-page="https://www.northwind-outdoor.example/our-footprint/"]');
  await expect(footprint.locator("li[data-year]")).toHaveCount(4);
  const removed = footprint.locator("li[data-removed]");
  await expect(removed).toHaveCount(1);
  await expect(removed).toContainText("claim removed between 2021 and 2024");
  await expect(removed).toContainText("Every Northwind jacket is climate neutral");
  await expect(footprint.locator('li[data-year="2024"]')).toContainText("claim removed between 2021 and 2024");
  // Every row links to its archived copy (the receipt).
  const hrefs = await footprint.locator("li[data-year] > a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  for (const h of hrefs) expect(h).toMatch(/^https:\/\/web\.archive\.org\/web\/\d{14}id_\//);
});

test("4.5 the redesign fixture shows its archived copies and no removed claim", async ({ page }) => {
  await analyseWebsite(page, "https://www.quillmoor-foods.example");
  await expect(page.getByTestId("progress").locator('[data-step="Pulling 2019–2026 snapshots"]')).toHaveAttribute("data-status", "done");
  const timeline = page.getByTestId("timeline");
  await expect(timeline.locator("li[data-year]")).toHaveCount(3);
  await expect(timeline.locator("li[data-removed]")).toHaveCount(0);
});

test("a real fixture brand without recorded history shows the Wayback step as skipped, not hidden", async ({ page }) => {
  await analyseWebsite(page, "https://www.oatly.com/");
  await expect(page.getByTestId("progress").locator('[data-step="Pulling 2019–2026 snapshots"]')).toContainText("skipped: Wayback unreachable");
  await expect(page.getByTestId("timeline")).toContainText("No archived copies were compared.");
});
