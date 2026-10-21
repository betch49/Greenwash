import { expect, test } from "@playwright/test";
import { search } from "./helpers";

// Phase 7, offline: the LLM is the MockLLM over fixtures/llm (GR_OFFLINE_FIXTURES=1 in playwright.config.ts).

test("7: the three AI-assisted steps appear in the progress list, and Fairphone's fixture summary is shown", async ({ page }) => {
  await search(page, "fairphone");
  await page.waitForURL(/\/(analyse|confirm)/);
  if (page.url().includes("/confirm")) await page.locator("[data-candidate]").first().getByRole("button", { name: "Confirm" }).click();
  await page.waitForURL(/\/analyse\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  const progress = page.getByTestId("progress");
  await expect(progress.locator('[data-step="Proposing candidate claims (AI)"]')).toHaveAttribute("data-status", "done");
  // No archived history is recorded for the real brands, so there is nothing to classify (shown, not hidden).
  await expect(progress.locator('[data-step="Classifying archived changes (AI)"]')).toContainText("skipped: no removed claim to classify");
  await expect(progress.locator('[data-step="Writing the plain-English summary (AI)"]')).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("summary")).toContainText("Fairphone: low signals");
  await expect(page.getByTestId("ai-share")).toHaveText("AI contributed to 0% of this score");
});

test("7.6: Northwind's classified removals make the AI share visible (> 0, ≤ 50%)", async ({ page }) => {
  await search(page, "acme");
  await page.waitForURL(/\/confirm\?/);
  await page.getByLabel("Brand website URL").fill("https://www.northwind-outdoor.example");
  await page.getByRole("button", { name: "Continue with this website" }).click();
  await page.waitForURL(/\/analyse\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(page.getByTestId("progress").locator('[data-step="Classifying archived changes (AI)"]')).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("ai-share")).toHaveText("AI contributed to 26% of this score");
  // The run's brand is the typed query here, so no summary fixture matches: the page says so.
  await expect(page.getByTestId("summary")).toHaveText("Summary unavailable");
});
