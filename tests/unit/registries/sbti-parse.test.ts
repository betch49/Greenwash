import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { SBTI_CONFIG, SBTI_FIELDS, SbtiParseError, excelSerialToIso, parseSbtiExport } from "@/lib/registries/sbti";
import { SBTI_DIR, sbtiFixture, sbtiManifest, sbtiRows } from "../helpers/sbti";

async function workbook(header: string[], rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data");
  ws.addRow(header);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("SBTi export parsing (11.1)", () => {
  it("the recorded export parses into rows with the 12 listed fields, as many as the README says", async () => {
    const rows = await sbtiRows();
    expect(rows.length).toBe(sbtiFixture().trimmedRows);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual([...SBTI_FIELDS].sort());
      expect(r.company_name).not.toBe("");
      if (r.date_updated) expect(r.date_updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("real rows read verbatim: Amazon (Commitment Removed, Expired commitment, 2020-06-18) and Fairphone B.V (validated)", async () => {
    const rows = await sbtiRows();
    const amazon = rows.find((r) => r.company_name === "Amazon")!;
    expect(amazon).toMatchObject({
      isin: "US0231351067",
      lei: "ZXTILKJKG63JELOEG630",
      near_term_status: "Commitment Removed",
      status_reason: "Expired commitment",
      date_updated: "2020-06-18",
      location: "United States of America",
    });
    const fairphone = rows.find((r) => r.company_name === "Fairphone B.V")!;
    expect(fairphone).toMatchObject({ near_term_status: "Validated Targets", near_term_target_year: "2030", net_zero_status: "Validated Targets", net_zero_year: "2045" });
    expect(fairphone.full_target_language.length).toBeGreaterThan(20);
  });

  it("date_updated converts from an Excel serial to an ISO date", async () => {
    expect(excelSerialToIso(45000)).toBe("2023-03-15");
    expect(excelSerialToIso(44000)).toBe("2020-06-18");
    const header = ["company_name", "near_term_status", "net_zero_status", "status_reason", "date_updated"];
    const bytes = await workbook(header, [["Serial Co", "Validated Targets", "", "", 45000]]);
    const [row] = await parseSbtiExport(bytes);
    expect(row.date_updated).toBe("2023-03-15");
  });

  it("a corrupt file or a workbook without the export's columns throws SbtiParseError", async () => {
    await expect(parseSbtiExport(Buffer.from("<html>not a workbook</html>"))).rejects.toBeInstanceOf(SbtiParseError);
    const other = await workbook(["name", "status"], [["x", "y"]]);
    await expect(parseSbtiExport(other)).rejects.toThrow(/missing columns: company_name/);
  });

  it("ADR-011: the fixture is the recorded export, listed in its manifest with a capture date; the README records the full file", () => {
    const files = sbtiManifest().files;
    expect(Object.keys(files)).toEqual([SBTI_CONFIG.exportUrl]);
    const entry = files[SBTI_CONFIG.exportUrl];
    expect(Number.isNaN(Date.parse(entry.capturedAt))).toBe(false);
    const listed = new Set(Object.values(files).map((f) => f.file));
    for (const f of readdirSync(SBTI_DIR)) if (f !== "manifest.json" && f !== "README.md") expect(listed.has(f), f).toBe(true);
    const readme = readFileSync(join(SBTI_DIR, "README.md"), "utf8");
    expect(readme).toMatch(/\| sha256 \| [0-9a-f]{64} \|/);
    expect(readme).toMatch(/\| last-modified \| .+ GMT \|/);
    expect(readme).toMatch(/\| Data rows \| \d{4,} \|/);
  });
});
