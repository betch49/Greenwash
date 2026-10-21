import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceManifest } from "@/lib/fetch/source-fixtures";

export const SOURCES = join("fixtures", "sources");
export const sourceManifest = () => JSON.parse(readFileSync(join(SOURCES, "manifest.json"), "utf8")) as SourceManifest;

/** A recorded source response by URL: its body and capture time. */
export function source(url: string): { body: string; capturedAt: string } {
  const entry = sourceManifest().files[url];
  if (!entry) throw new Error(`no recorded source for ${url}`);
  return { body: readFileSync(join(SOURCES, entry.file), "utf8"), capturedAt: entry.capturedAt };
}
