import type { Page } from "@playwright/test";
import { REPORT, openReport, search } from "./helpers";

/**
 * The report for a fixture brand: the cached one when the search is re-served
 * (8.5), otherwise a new run is analysed and opened. Returns the report id.
 */
export async function reportFor(page: Page, query: string): Promise<string> {
  await search(page, query);
  await page.waitForURL((u) => /^\/(analyse|confirm|report)/.test(u.pathname));
  if (page.url().includes("/confirm")) {
    await page.locator("[data-candidate]").first().getByRole("button", { name: "Confirm" }).click();
    await page.waitForURL((u) => /^\/(analyse|report)\//.test(u.pathname));
  }
  if (REPORT.test(new URL(page.url()).pathname)) return new URL(page.url()).pathname.split("/report/")[1];
  return openReport(page);
}

export const FIXTURE_QUERIES = ["mammut sports group", "fairphone", "oatly"] as const;
