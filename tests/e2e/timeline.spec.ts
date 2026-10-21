import { expect, test, type Page } from "@playwright/test";
import { analyseWebsite as analyse } from "./helpers";

// Both brands are fictional, test-only fixtures on .example domains with hand-built Wayback histories (ADR-011).
async function analyseWebsite(page: Page, website: string) {
  await analyse(page, website);
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
}

test("4.7 the removed-claim fixture shows a timeline with the year the claim disappeared", async ({ page }) => {
  await analyseWebsite(page, "https://www.northwind-outdoor.example");

  // The server clock is pinned to 2026-10-20 (GR_FIXED_NOW in playwright.config.ts); literal label on purpose.
  await expect(page.getByTestId("progress").locator('[data-step="Pulling 2019–2026 snapshots"]')).toHaveAttribute("data-status", "done");

  const timeline = page.getByTestId("timeline");
  await expect(timeline.getByRole("heading", { name: "Timeline of archived claims" })).toBeVisible();
  const footprint = timeline.locator('[data-page="https://www.northwind-outdoor.example/our-footprint/"]');
  // Four archived copies plus the live page as the last row (ADR-017, Phase 7).
  await expect(footprint.locator("li[data-year]")).toHaveCount(5);
  const removed = footprint.locator("li[data-removed]");
  await expect(removed).toHaveCount(2);
  await expect(removed.first()).toContainText("claim removed between 2021 and 2024");
  await expect(removed.first()).toContainText("Every Northwind jacket is climate neutral");
  await expect(footprint.locator('li[data-year="2024"]')).toContainText("claim removed between 2021 and 2024");
  const live = footprint.locator("li[data-live]");
  await expect(live).toHaveCount(1);
  await expect(live).toContainText("current page (fetched 2026-10-20)");
  await expect(live).toContainText("claim removed between 2025 and the current page");
  await expect(live).toContainText("Our dyes are eco-friendly and kind to rivers.");
  await expect(live.locator("> a")).toHaveAttribute("href", "https://www.northwind-outdoor.example/our-footprint/");
  // Every archived row links to its archived copy (the receipt).
  const hrefs = await footprint.locator("li[data-year]:not([data-live]) > a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect(hrefs).toHaveLength(4);
  for (const h of hrefs) expect(h).toMatch(/^https:\/\/web\.archive\.org\/web\/\d{14}id_\//);
});

test("4.5 the redesign fixture shows its archived copies and no removed claim", async ({ page }) => {
  await analyseWebsite(page, "https://www.quillmoor-foods.example");
  await expect(page.getByTestId("progress").locator('[data-step="Pulling 2019–2026 snapshots"]')).toHaveAttribute("data-status", "done");
  const timeline = page.getByTestId("timeline");
  // Three archived copies plus the live page; every claim is still on the live page.
  await expect(timeline.locator("li[data-year]")).toHaveCount(4);
  await expect(timeline.locator("li[data-live]")).toHaveCount(1);
  await expect(timeline.locator("li[data-removed]")).toHaveCount(0);
});

test("a real fixture brand without recorded history shows the Wayback step as skipped, not hidden", async ({ page }) => {
  await analyseWebsite(page, "https://www.oatly.com/");
  await expect(page.getByTestId("progress").locator('[data-step="Pulling 2019–2026 snapshots"]')).toContainText("skipped: Wayback Machine: no archived copies found");
  await expect(page.getByTestId("timeline")).toContainText("No archived copies were compared.");
});
