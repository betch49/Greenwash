import { expect, test } from "@playwright/test";
import { analyseBrand, analyseWebsite, openReport } from "./helpers";

// 8.1, offline (GR_OFFLINE_FIXTURES=1): search → confirm → analyse → report for each real fixture brand.
const BRANDS = [
  { query: "mammut sports group", brand: "Mammut" },
  { query: "fairphone", brand: "Fairphone" },
  { query: "oatly", brand: "Oatly" },
];

for (const b of BRANDS) {
  test(`8.1 full flow for ${b.brand}: the report shows score, label, basis (N, M > 0) and the AI share line`, async ({ page }) => {
    await analyseBrand(page, b.query);
    const id = await openReport(page);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(b.brand);
    await expect(page.getByTestId("score")).toHaveText(/^\d{1,3}$/);
    const score = Number(await page.getByTestId("score").textContent());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    await expect(page.getByTestId("score-label")).toHaveText(/^(Low|Moderate|High) signals$/);
    const basis = (await page.getByTestId("score-basis").textContent()) ?? "";
    const m = /^Based on (\d+) verified signals? from (\d+) sources?\.$/.exec(basis);
    expect(m, basis).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(Number(m![2])).toBeGreaterThan(0);
    await expect(page.getByTestId("score-line")).toHaveText(/^Confidence \d{1,3}%$/);
    await expect(page.getByTestId("ai-share")).toHaveText(/^AI contributed to \d{1,2}% of this score$/);
    // Desktop: four axis sections, each with its sub-score (8.6, desktop half).
    await expect(page.locator("section[data-axis]")).toHaveCount(4);
    for (const axis of ["claims", "evidence", "track", "repair"]) await expect(page.getByTestId(`subscore-${axis}`)).toHaveText(/^(Sub-score \d{1,3}\/100|—)$/);
    await expect(page.getByRole("link", { name: "How the score is computed" })).toHaveAttribute("href", "/methodology");
    await expect(page.getByTestId("share-link")).toHaveText(new RegExp(`/report/${id}$`));
    await expect(page.getByTestId("download-json")).toHaveAttribute("href", `/api/reports/${id}.json`);
    await expect(page.getByTestId("summary")).not.toHaveText("Summary unavailable");
    await expect(page.getByTestId("summary-note")).toBeVisible();
    await page.screenshot({ path: `test-results/report-desktop-${b.brand.toLowerCase()}.png`, fullPage: true });
  });
}

test("8.1 Northwind via the URL fallback: summary with its AI note, AI-assisted receipts, live timeline row, AI calls listed", async ({ page }) => {
  await analyseWebsite(page, "https://www.northwind-outdoor.example");
  await openReport(page);
  // ADR-021 carry-forward: the URL-fallback input has its own (stand-in) summary fixture.
  await expect(page.getByTestId("summary")).toContainText("Northwind Outdoor Clothing & Gear: moderate signals");
  await expect(page.getByTestId("summary-note")).toHaveText(/Written by an AI model/);
  await expect(page.getByTestId("ai-share")).toHaveText("AI contributed to 26% of this score");
  const llmRows = page.locator("[data-signal][data-llm]");
  await expect(llmRows).toHaveCount(2);
  for (const row of await llmRows.all()) await expect(row).toContainText("AI-assisted");
  const live = page.getByTestId("timeline").locator("li[data-live]");
  await expect(live).toHaveCount(1);
  await expect(live).toContainText("claim removed between 2025 and the current page");
  await expect(page.getByTestId("llm-calls")).toContainText("classify-diff: ok (recorded answer)");
  await expect(page.getByTestId("llm-calls")).toContainText("summary: ok (recorded answer)");
});
