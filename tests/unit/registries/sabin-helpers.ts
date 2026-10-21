import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceManifest } from "@/lib/fetch/source-fixtures";

export const SABIN_DIR = join("fixtures", "sources", "sabin");
export const sabinManifest = () => JSON.parse(readFileSync(join(SABIN_DIR, "manifest.json"), "utf8")) as SourceManifest;

/** A recorded Sabin page by URL: its body and capture time. */
export function sabinPage(url: string): { body: string; capturedAt: string } {
  const entry = sabinManifest().files[url];
  if (!entry) throw new Error(`no recorded Sabin page for ${url}`);
  return { body: readFileSync(join(SABIN_DIR, entry.file), "utf8"), capturedAt: entry.capturedAt };
}

export const synthetic = (name: string) => readFileSync(join(SABIN_DIR, "synthetic", name), "utf8");

export const DOC = {
  total: "https://www.climatecasechart.com/document/greenpeace-france-and-others-v-totalenergies-se-and-totalenergies-electricite-et-gaz-france_3e1f",
  blackrock: "https://www.climatecasechart.com/document/clientearth-v-blackrock_51f1",
  shellNl: "https://www.climatecasechart.com/document/milieudefensie-et-al-v-royal-dutch-shell-plc_c3e4",
  shellBoard: "https://www.climatecasechart.com/document/clientearth-v-shells-board-of-directors_9377",
} as const;

export const GEO = (slug: string) => `https://www.climatecasechart.com/geographies/${slug}`;
