// Criterion 10.8: METHODOLOGY Section 13 exists and says labels are evaluation-only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("METHODOLOGY Section 13 (10.8)", () => {
  const doc = readFileSync(join(process.cwd(), "docs", "METHODOLOGY.md"), "utf8");
  const section = doc.split(/^## /m).find((s) => s.startsWith("13. Validation (evaluation only)"));

  it("exists", () => {
    expect(section).toBeDefined();
  });
  it("contains the evaluation-only sentence", () => {
    expect(section).toContain("Ground-truth labels are used for evaluation only and never enter the score.");
  });
  it("says what well-rated means, how AUC is computed and where results live", () => {
    expect(section).toMatch(/weak label by construction/);
    expect(section).toMatch(/Mann–Whitney/);
    expect(section).toContain("docs/validation/RESULTS.md");
  });
});
