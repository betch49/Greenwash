import { expect, test } from "@playwright/test";
import { analyseBrand, analyseWebsite } from "./helpers";

// Phase 7, offline: the LLM is the MockLLM over fixtures/llm (GR_OFFLINE_FIXTURES=1 in playwright.config.ts).

test("7: the three AI-assisted steps appear in the progress list, and Fairphone's fixture summary is shown", async ({ page }) => {
  await analyseBrand(page, "fairphone");
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
  await analyseWebsite(page, "https://www.northwind-outdoor.example");
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(page.getByTestId("progress").locator('[data-step="Classifying archived changes (AI)"]')).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("ai-share")).toHaveText("AI contributed to 26% of this score");
  // Phase 8 (ADR-021): the URL-fallback input ("acme" + the Northwind website) has its own summary fixture.
  await expect(page.getByTestId("summary")).toContainText("acme: moderate signals");
});
