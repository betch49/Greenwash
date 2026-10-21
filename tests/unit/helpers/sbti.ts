import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceManifest } from "@/lib/fetch/source-fixtures";
import { SBTI_CONFIG, parseSbtiExport, type SbtiRow } from "@/lib/registries/sbti";

export const SBTI_DIR = join("fixtures", "sources", "sbti");
export const sbtiManifest = () => JSON.parse(readFileSync(join(SBTI_DIR, "manifest.json"), "utf8")) as SourceManifest;

/** The recorded (trimmed) SBTi export: bytes, capture time and the README's trimmed row count. */
export function sbtiFixture(): { bytes: Buffer; capturedAt: string; trimmedRows: number; file: string } {
  const entry = sbtiManifest().files[SBTI_CONFIG.exportUrl];
  if (!entry) throw new Error("no recorded SBTi export");
  const readme = readFileSync(join(SBTI_DIR, "README.md"), "utf8");
  const m = /\| Trimmed data rows \| (\d+) \|/.exec(readme);
  if (!m) throw new Error("README.md has no trimmed row count");
  return { bytes: readFileSync(join(SBTI_DIR, entry.file)), capturedAt: entry.capturedAt, trimmedRows: Number(m[1]), file: entry.file };
}

let rows: Promise<SbtiRow[]> | undefined;
export const sbtiRows = () => (rows ??= parseSbtiExport(sbtiFixture().bytes));
