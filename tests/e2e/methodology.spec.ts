import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { analyseBrand } from "./helpers";

const weights = JSON.parse(readFileSync("config/weights.json", "utf8")) as {
  axes: Record<string, number>;
  points: Record<string, Record<string, number>>;
  llmGuard: { maxShare: number };
  claimsRate: { version: number; v2: { minClaims: number } };
};

test("6.7 /methodology renders every axis of weights.json with its percentage, every kind, and the document", async ({ page }) => {
  await page.goto("/methodology");
  await expect(page.getByRole("heading", { level: 1, name: "Methodology" })).toBeVisible();
  const table = page.getByTestId("axis-weights");
  for (const [axis, w] of Object.entries(weights.axes)) {
    await expect(table.locator(`[data-axis="${axis}"]`)).toContainText(axis);
    await expect(page.getByTestId(`weight-${axis}`)).toHaveText(`${Math.round(w * 100)}%`);
  }
  const kinds = page.getByTestId("kind-points");
  for (const kind of Object.values(weights.points).flatMap((t) => Object.keys(t))) await expect(kinds).toContainText(kind);
  await expect(page.getByTestId("params")).toContainText("llmGuard.maxShare");
  await expect(page.getByTestId("params")).toContainText(String(weights.llmGuard.maxShare));
  // Phase 14 (14.4): the active claims formula version and minClaims are rendered from the same file.
  await expect(page.getByTestId("params")).toContainText("claimsRate.version");
  await expect(page.getByTestId("params")).toContainText("claimsRate.v2.minClaims");
  await expect(page.getByTestId("params")).toContainText(String(weights.claimsRate.v2.minClaims));
  // The rest of docs/METHODOLOGY.md is rendered below the generated tables.
  const doc = page.getByTestId("methodology-doc");
  await expect(doc.getByRole("heading", { name: "11. From signals to a score" })).toBeVisible();
  await expect(doc.getByRole("heading", { name: /Claim-language rules/ })).toBeVisible();
  // The site header links here.
  await page.goto("/");
  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Methodology" }).click();
  await expect(page).toHaveURL(/\/methodology$/);
});

test("6 a finished run shows 'Score N, confidence M%', the AI share and the basis line (Oatly fixture)", async ({ page }) => {
  await analyseBrand(page, "oatly");
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  // Pinned in tests/unit/score/fixtures.test.ts (same fixtures, same pinned clock).
  await expect(page.getByTestId("score-line")).toHaveText("Score 35, confidence 100%");
  await expect(page.getByTestId("score-label")).toHaveText("Moderate signals");
  await expect(page.getByTestId("ai-share")).toHaveText("AI contributed to 0% of this score");
  await expect(page.getByTestId("score-basis")).toHaveText(/^Based on \d+ verified signals from \d+ sources\.$/);
  await page.getByRole("link", { name: "How the score is computed" }).click();
  await expect(page).toHaveURL(/\/methodology$/);
});
