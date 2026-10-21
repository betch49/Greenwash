import { expect, test } from "@playwright/test";
import { findForbidden } from "../../src/lib/copy/forbidden";
import { FIXTURE_QUERIES, reportFor } from "./report-helpers";

// 8.8: the forbidden-word filter (ADR-008) over the rendered HTML of the three fixture reports.
for (const query of FIXTURE_QUERIES) {
  test(`8.8 the rendered report of "${query}" contains no forbidden word`, async ({ page }) => {
    await reportFor(page, query);
    const html = await page.content();
    const text = await page.locator("body").innerText();
    expect(text.length).toBeGreaterThan(500);
    expect(findForbidden(text).map((h) => `${h.term}: …${h.context}…`)).toEqual([]);
    expect(findForbidden(html).map((h) => `${h.term}: …${h.context}…`)).toEqual([]);
  });
}
