import { expect, test } from "@playwright/test";
import { REPORT, analyseWebsite, openReport, runCount, search } from "./helpers";
import { reportFor } from "./report-helpers";

test("8.5 a second visit is served from the stored report in < 1 s; searching the brand again re-serves the same report without a new run", async ({ page, request }) => {
  const id = await reportFor(page, "oatly");
  // First visit done above (the dev server compiled the route). Second visit, timed:
  const t0 = Date.now();
  const res = await request.get(`/report/${id}`);
  const ms = Date.now() - t0;
  expect(res.status()).toBe(200);
  expect(res.headers()["x-gr-served-from"]).toBe("cache");
  expect(ms).toBeLessThan(1000);
  console.log(`8.5 /report/${id} re-served in ${ms} ms`);
  const json = await request.get(`/api/reports/${id}.json`);
  expect(json.headers()["x-gr-served-from"]).toBe("cache");

  const before = await runCount(request);
  await search(page, "oatly");
  await page.waitForURL(REPORT);
  expect(new URL(page.url()).pathname).toBe(`/report/${id}`);
  expect(await runCount(request)).toBe(before);

  // "Re-run" forces a new run (and only then a new run row exists).
  await page.goto(`/report/${id}`);
  await page.getByRole("button", { name: "Re-run the analysis" }).click();
  await page.waitForURL(/\/analyse\/[0-9a-f-]{36}$/);
  expect(await runCount(request)).toBe(before + 1);
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
});

test("8.5 the URL fallback re-serves a report for the same website, whatever name was typed (the name comes from the site)", async ({ page, request }) => {
  const website = "https://www.quillmoor-foods.example";
  await analyseWebsite(page, website, "quillmoor");
  const id = await openReport(page);
  const before = await runCount(request);
  await search(page, "Quillmoor");
  await page.getByLabel("Brand website URL").fill(`${website}/`);
  await page.getByRole("button", { name: "Continue with this website" }).click();
  await page.waitForURL(REPORT);
  expect(new URL(page.url()).pathname).toBe(`/report/${id}`);
  expect(await runCount(request)).toBe(before);
  // QA fix round: the run is named from the fetched homepage, not the typed query, so another
  // typed name for the same website resolves to the same brand and re-serves the same report.
  await search(page, "acme");
  await page.getByLabel("Brand website URL").fill(website);
  await page.getByRole("button", { name: "Continue with this website" }).click();
  await page.waitForURL(REPORT);
  expect(new URL(page.url()).pathname).toBe(`/report/${id}`);
  expect(await runCount(request)).toBe(before);
});
