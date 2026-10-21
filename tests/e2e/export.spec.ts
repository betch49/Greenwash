import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { FIXTURE_QUERIES, reportFor } from "./report-helpers";

for (const query of FIXTURE_QUERIES) {
  test(`8.4 "${query}": the JSON export downloads, parses as ReportV1, and its signals equal the rendered rows`, async ({ page }) => {
    const id = await reportFor(page, query);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-json").click()]);
    expect(download.suggestedFilename()).toBe(`greenwash-radar-report-${id}.json`);
    // zod parse with the app's own ReportV1Schema (run through tsx, which loads the JSON config the schema imports).
    const out = execFileSync("npx", ["tsx", "scripts/validate-report.ts", (await download.path())!], { encoding: "utf8" });
    const r = JSON.parse(out) as { ok: boolean; signals: number; signal_ids: string[]; signals_count: number; llm_calls: number; could_not_check: number };
    expect(r.ok).toBe(true);
    await expect(page.locator("[data-signal]")).toHaveCount(r.signals);
    expect(r.signals_count).toBe(r.signals);
    for (const sid of r.signal_ids) await expect(page.locator(`[data-signal="${sid}"]`)).toHaveCount(1);
    // Phase 7 carry-forward: the AI call log travels with the evidence.
    expect(r.llm_calls).toBeGreaterThan(0);
    expect(r.could_not_check).toBeGreaterThan(0);
  });
}

test("8.4 an unknown report id is a 404, not an empty file", async ({ request }) => {
  expect((await request.get("/api/reports/00000000-0000-0000-0000-000000000000.json")).status()).toBe(404);
  expect((await request.get("/api/reports/not-an-id")).status()).toBe(404);
  expect((await request.get("/report/00000000-0000-0000-0000-000000000000")).status()).toBe(404);
});
