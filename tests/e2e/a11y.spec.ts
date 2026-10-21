import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { reportFor } from "./report-helpers";

// 8.7 axe path (the documented fallback in PLAN Phase 8 deliverable 4; Lighthouse runs via `npm run lighthouse`).
// Zero serious or critical WCAG 2.x A/AA violations, in light and dark mode.
async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}

for (const scheme of ["light", "dark"] as const) {
  test(`8.7 axe: /, /confirm (cards and URL fallback), /report/[id], /methodology have no serious/critical violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const reportId = await reportFor(page, "fairphone");
    for (const path of ["/", "/confirm?q=continental", "/confirm?q=acme", `/report/${reportId}`, "/methodology"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await seriousViolations(page), `${path} (${scheme})`).toEqual([]);
    }
  });
}
