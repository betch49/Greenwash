import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { FixtureMap } from "./fixture-fetcher";

/**
 * Normalised manifest key: lowercase scheme and host, no fragment, no trailing
 * slash (except the root), query kept. "https://WWW.x.com/a/" ≡ "https://www.x.com/a".
 */
export function fixtureKey(url: string): string | null {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : "/";
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return null;
  }
}

/**
 * `fixtures/brands/<slug>/manifest.json`. `files` maps each URL the pipeline
 * requests to a file relative to the brand directory; `capturedAt` is served as
 * `fetched_at` so offline receipts carry the real capture date.
 */
export interface BrandManifest {
  capturedAt: string;
  files: Record<string, string>;
}

export interface BrandFixtures {
  map: FixtureMap;
  /** Capture date of the fixture serving `url`, if it is a brand fixture. */
  capturedAt: (url: string) => string | undefined;
}

/** Loads every brand manifest under `<root>/brands/`. Unlisted URLs ⇒ null (served as 404). */
export function loadBrandFixtures(root: string): BrandFixtures {
  const map = new Map<string, { rel: string; capturedAt: string }>();
  const dir = join(root, "brands");
  if (existsSync(dir)) {
    for (const slug of readdirSync(dir).sort()) {
      const file = join(dir, slug, "manifest.json");
      if (!existsSync(file)) continue;
      const manifest = JSON.parse(readFileSync(file, "utf8")) as BrandManifest;
      for (const [url, rel] of Object.entries(manifest.files)) {
        const key = fixtureKey(url);
        if (key && !map.has(key)) map.set(key, { rel: `brands/${slug}/${rel}`, capturedAt: manifest.capturedAt });
      }
    }
  }
  const lookup = (url: string) => {
    const key = fixtureKey(url);
    return key ? map.get(key) : undefined;
  };
  return { map: (url) => lookup(url)?.rel ?? null, capturedAt: (url) => lookup(url)?.capturedAt };
}
