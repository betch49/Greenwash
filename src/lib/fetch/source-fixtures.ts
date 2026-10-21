import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureKey } from "./brand-fixtures";
import type { FixtureMap } from "./fixture-fetcher";

/**
 * `fixtures/sources/manifest.json` (Phase 5): recorded responses of the regulator and
 * repair sources (ASA, JDP, iFixit), which are not brand sites. Each URL carries its
 * own capture date, served as `fetched_at`. Real captures only (ADR-011).
 */
export interface SourceManifest {
  files: Record<string, { file: string; capturedAt: string }>;
}

export const SOURCES_DIR = "sources";

/** Source directories with their own manifest.json (Phase 13: the Sabin litigation pages). */
export const SUB_MANIFEST_DIRS = ["sabin"] as const;

export interface SourceFixtures {
  map: FixtureMap;
  capturedAt: (url: string) => string | undefined;
}

export function loadSourceFixtures(root: string): SourceFixtures {
  const map = new Map<string, { rel: string; capturedAt: string }>();
  const file = join(root, SOURCES_DIR, "manifest.json");
  if (existsSync(file)) {
    const manifest = JSON.parse(readFileSync(file, "utf8")) as SourceManifest;
    for (const [url, entry] of Object.entries(manifest.files)) {
      const key = fixtureKey(url);
      if (key && !map.has(key)) map.set(key, { rel: `${SOURCES_DIR}/${entry.file}`, capturedAt: entry.capturedAt });
    }
  }
  // v1.1 registries keep their own manifest (`fixtures/sources/<dir>/manifest.json`, paths relative to <dir>).
  for (const dir of SUB_MANIFEST_DIRS) {
    const sub = join(root, SOURCES_DIR, dir, "manifest.json");
    if (!existsSync(sub)) continue;
    const manifest = JSON.parse(readFileSync(sub, "utf8")) as SourceManifest;
    for (const [url, entry] of Object.entries(manifest.files)) {
      const key = fixtureKey(url);
      if (key && !map.has(key)) map.set(key, { rel: `${SOURCES_DIR}/${dir}/${entry.file}`, capturedAt: entry.capturedAt });
    }
  }
  const lookup = (url: string) => {
    const key = fixtureKey(url);
    return key ? map.get(key) : undefined;
  };
  return { map: (url) => lookup(url)?.rel ?? null, capturedAt: (url) => lookup(url)?.capturedAt };
}
