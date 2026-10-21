import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";
import { litigationWording as lw } from "../../src/lib/copy/wording";
import { analyseBrand, openReport } from "./helpers";

// 13.8: a litigation.case receipt row links to www.climatecasechart.com. No fixture brand
// (Mammut, Fairphone, Oatly) is named by a case, so — as possible-match.spec.ts does — this
// test stores a copy of the Oatly report with one litigation.case signal built from the real
// TotalEnergies capture (fixtures/sources/sabin/, values as parsed by
// tests/unit/registries/sabin-fixtures.test.ts) in the e2e database the server reads.
const DB = "test-results/e2e.db";
const URL_TOTAL = "https://www.climatecasechart.com/document/greenpeace-france-and-others-v-totalenergies-se-and-totalenergies-electricite-et-gaz-france_3e1f";

test("13.8 /analyse lists the climate litigation step with the coverage sentence (offline)", async ({ page }) => {
  await analyseBrand(page, "fairphone");
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  const row = page.getByTestId("progress").locator(`[data-step="${lw.step}"]`);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("could-not-check")).toContainText("Climate litigation coverage: only the newest cases listed for");
});

test("13.8 a litigation.case receipt row links to www.climatecasechart.com and says a filed case is not a ruling", async ({ page, request }) => {
  await analyseBrand(page, "oatly");
  const source = await openReport(page);
  const report = await (await request.get(`/api/reports/${source}.json`)).json();
  const manifest = JSON.parse(readFileSync("fixtures/sources/sabin/manifest.json", "utf8")) as { files: Record<string, { capturedAt: string }> };
  const signal = {
    id: "litigation-sabin-e2e",
    axis: "track",
    kind: "litigation.case",
    label: lw.caseFound("TotalEnergies SE", "Decided", 2022),
    weight_hint: 1,
    source_url: URL_TOTAL,
    fetched_at: manifest.files[URL_TOTAL].capturedAt,
    excerpt: lw.excerpt("Greenpeace France and Others v. TotalEnergies SE and TotalEnergies Electricité et Gaz France", "On March 2, 2022, Greenpeace France, Les Amis de la Terre France, and Notre Affaire à Tous …", "Decided", "Decision (2025-10-23)", URL_TOTAL),
    entity_name: "TotalEnergies SE",
    llm_used: false,
  };
  const axes = (report.axes as { id: string; signals: unknown[] }[]).map((a) => (a.id === "track" ? { ...a, signals: [...a.signals, signal] } : a));
  const id = randomUUID();
  const db = new Database(DB);
  try {
    db.prepare("INSERT INTO reports (id, run_id, brand, website, data, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      id,
      report.run_id,
      report.brand,
      "https://litigation-test.example",
      JSON.stringify({ ...report, axes }),
      report.generated_at,
    );
  } finally {
    db.close();
  }
  await page.goto(`/report/${id}`);
  const row = page.locator('section[data-axis="track"] [data-kind="litigation.case"]');
  await expect(row).toHaveCount(1);
  expect(new URL((await row.locator("a[data-source]").getAttribute("href")) ?? "").host).toBe("www.climatecasechart.com");
  await expect(row).toContainText("a filed case is not a ruling");
  await expect(row).toContainText("Source: Sabin Center for Climate Change Law, Climate Litigation Database");
  await expect(row.locator("[data-fetched]")).toHaveText(/^fetched \d{4}-\d{2}-\d{2}$/);
});
