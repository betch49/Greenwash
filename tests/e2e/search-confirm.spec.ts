import { expect, test } from "@playwright/test";
import { runCount, search } from "./helpers";

// Recorded Wikidata fixture with two plausible companies (Continental AG, United Airlines).
const AMBIGUOUS = "continental";

test("1.6 'patagonia' + Enter reaches /analyse showing the brand (confident match auto-proceeds)", async ({ page }) => {
  await search(page, "patagonia");
  const card = page.locator("[data-candidate]").first();
  // Confident ⇒ auto-proceed; otherwise confirm the Patagonia card.
  await page.waitForURL(/\/(analyse|confirm)/);
  if (page.url().includes("/confirm")) {
    await expect(card).toContainText("Patagonia, Inc.");
    await card.getByRole("button", { name: "Confirm" }).click();
  }
  await page.waitForURL(/\/analyse\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Patagonia");
  await expect(page.getByTestId("brand")).toHaveText("Patagonia, Inc.");
  await expect(page.getByTestId("website")).toHaveText("patagonia.com");
});

test("1.7 'acme' shows the URL fallback; pasting https://example.com proceeds", async ({ page, request }) => {
  const before = await runCount(request);
  await search(page, "acme");
  await page.waitForURL(/\/confirm\?/);
  await expect(page.locator("[data-candidate]")).toHaveCount(0);
  const url = page.getByLabel("Brand website URL");
  await expect(url).toBeVisible();
  expect(await runCount(request)).toBe(before);
  await url.fill("https://example.com");
  await url.press("Enter");
  await page.waitForURL(/\/analyse\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("website")).toHaveText("example.com");
  // QA fix round: named after the fetched homepage, else the domain (example.com is not in the fixtures).
  await expect(page.getByTestId("brand")).toHaveText("example.com");
  expect(await runCount(request)).toBe(before + 1);
});

test("1.7 an invalid pasted URL is refused and no run is created", async ({ page, request }) => {
  const before = await runCount(request);
  await search(page, "acme");
  const url = page.getByLabel("Brand website URL");
  await url.fill("not a url");
  await url.press("Enter");
  await expect(page.getByRole("alert")).toContainText("valid website address");
  expect(await runCount(request)).toBe(before);
});

test("1.8 rejecting every card shows the URL fallback and creates no run", async ({ page, request }) => {
  const before = await runCount(request);
  await search(page, AMBIGUOUS);
  await page.waitForURL(/\/confirm\?/);
  const cards = page.locator("[data-candidate]");
  const n = await cards.count();
  expect(n).toBeGreaterThanOrEqual(2);
  expect(n).toBeLessThanOrEqual(3);
  for (let i = n; i > 0; i--) {
    await expect(cards).toHaveCount(i);
    await cards.first().getByRole("link", { name: "Not this one" }).click();
  }
  await expect(cards).toHaveCount(0);
  await expect(page.getByLabel("Brand website URL")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("None of these");
  expect(await runCount(request)).toBe(before);
});

test("confirming one card of an ambiguous search creates exactly one run", async ({ page, request }) => {
  const before = await runCount(request);
  await search(page, AMBIGUOUS);
  const first = page.locator("[data-candidate]").first();
  const name = (await first.locator("strong").textContent())?.trim() ?? "";
  await first.getByRole("button", { name: "Confirm" }).click();
  await page.waitForURL(/\/analyse\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("brand")).toHaveText(name);
  expect(await runCount(request)).toBe(before + 1);
});
