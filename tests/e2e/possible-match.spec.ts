import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";
import { couldNotCheck } from "../../src/lib/copy/wording";
import { analyseWebsite, openReport } from "./helpers";

// ADR-019: a "possible" regulator match is shown under "What we could not check" with the
// entity verbatim and "not scored", never as a receipt of the track axis. No fixture brand
// has one, so this test stores a copy of the fictional Northwind report (ADR-011) with one
// possible-match line added, in the e2e database the server reads (playwright.config.ts).
const DB = "test-results/e2e.db";

test("ADR-019: possible matches render as not scored, with the entity verbatim, outside the receipts", async ({ page, request }) => {
  await analyseWebsite(page, "https://www.northwind-outdoor.example");
  const source = await openReport(page);
  const report = await (await request.get(`/api/reports/${source}.json`)).json();
  const line = couldNotCheck.regulatorPossible("ASA", "Northwind Outdoor Holdings Trading Ltd", "https://www.asa.org.uk/rulings/northwind-example.html");
  const id = randomUUID();
  const db = new Database(DB);
  try {
    db.prepare("INSERT INTO reports (id, run_id, brand, website, data, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      id,
      report.run_id,
      report.brand,
      "https://possible-match-test.example",
      JSON.stringify({ ...report, could_not_check: [...report.could_not_check, line] }),
      report.generated_at,
    );
  } finally {
    db.close();
  }
  await page.goto(`/report/${id}`);
  const possible = page.getByTestId("possible-matches").locator("li[data-possible]");
  await expect(possible).toHaveCount(1);
  await expect(possible).toHaveText(line);
  await expect(possible).toContainText("Possible match, not scored");
  await expect(possible).toContainText("“Northwind Outdoor Holdings Trading Ltd”");
  await expect(page.getByTestId("could-not-check")).not.toContainText("Possible match");
  await expect(page.locator('section[data-axis="track"]')).not.toContainText("Northwind Outdoor Holdings Trading Ltd");
});
