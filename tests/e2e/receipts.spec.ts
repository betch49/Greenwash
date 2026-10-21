import { expect, test } from "@playwright/test";
import { FIXTURE_QUERIES, reportFor } from "./report-helpers";

for (const query of FIXTURE_QUERIES) {
  test(`8.2 / 8.3 every receipt row of "${query}" has an http link, a fetch date and an excerpt; could-not-check and skipped steps are rendered`, async ({ page, request }) => {
    const id = await reportFor(page, query);
    const json = await (await request.get(`/api/reports/${id}.json`)).json();

    const rows = page.locator("[data-signal]");
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      const href = await row.locator("a[data-source]").getAttribute("href");
      expect(href, `row ${i}`).toMatch(/^http/);
      await expect(row.locator("[data-fetched]")).toHaveText(/^fetched \d{4}-\d{2}-\d{2}$/);
      expect(((await row.locator("[data-excerpt]").textContent()) ?? "").trim().length, `row ${i} excerpt`).toBeGreaterThan(0);
      // Every row shows its points; protective kinds show their 0 (ADR-020), never hidden.
      await expect(row.locator("[data-points]")).toHaveText(/risk points?|0 points \(protective/);
    }

    const cnc = page.getByTestId("could-not-check").locator("li");
    expect(await cnc.count()).toBeGreaterThanOrEqual(1);
    const skipped = json.skipped as { step: string; reason: string }[];
    if (skipped.length > 0) {
      await expect(page.getByTestId("skipped").locator("li")).toHaveCount(skipped.length);
      for (const s of skipped) await expect(page.getByTestId("skipped")).toContainText(`skipped: ${s.reason}`);
    } else {
      await expect(page.getByText("No step was skipped.")).toBeVisible();
    }
    // Each axis states its status wording (Phase 6 carry-forward).
    for (const axis of await page.locator("section[data-axis]").all()) await expect(axis.locator("[data-axis-status]")).toHaveText(/^(scored|no data \(lowers confidence\)|not applicable \(weight shared out\))$/);
  });
}

test("ADR-020: protective signals are listed with 0 points (Fairphone's repair findings)", async ({ page }) => {
  await reportFor(page, "fairphone");
  const protective = page.locator('section[data-axis="repair"] [data-signal] [data-points="0"]');
  expect(await protective.count()).toBeGreaterThan(0);
  await expect(protective.first()).toHaveText("0 points (protective: listed, counts as data)");
});
