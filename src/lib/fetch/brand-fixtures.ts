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
  /**
   * Wayback history (Phase 4): brand page URL ⇒ page slug. The CDX query for the
   * page is served from `cdx/<page-slug>.json` and the `id_` snapshot with
   * timestamp YYYYMMDDhhmmss from `snapshots/<page-slug>/<YYYYMMDD>.html`.
   * Hand-built histories are allowed only for fictional brands (ADR-011).
   */
  wayback?: Record<string, string>;
}

const WAYBACK_HOST = "web.archive.org";
const SNAPSHOT_PATH = /^\/web\/(\d{14})id_\/(.+)$/;

/** The brand page a Wayback URL asks about, and the snapshot timestamp if it is an `id_` URL. */
export function waybackTarget(url: string): { page: string; timestamp?: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.host !== WAYBACK_HOST) return null;
  if (u.pathname === "/cdx/search/cdx") {
    const page = u.searchParams.get("url");
    return page ? { page } : null;
  }
  const m = SNAPSHOT_PATH.exec(u.pathname + u.search);
  return m ? { page: m[2], timestamp: m[1] } : null;
}

export interface BrandFixtures {
  map: FixtureMap;
  /** Capture date of the fixture serving `url`, if it is a brand fixture. */
  capturedAt: (url: string) => string | undefined;
}

/** Loads every brand manifest under `<root>/brands/`. Unlisted URLs ⇒ null (served as 404). */
export function loadBrandFixtures(root: string): BrandFixtures {
  const map = new Map<string, { rel: string; capturedAt: string }>();
  /** Brand page key ⇒ { brand dir, page slug, capture date } for Wayback fixtures. */
  const history = new Map<string, { dir: string; pageSlug: string; capturedAt: string }>();
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
      for (const [url, pageSlug] of Object.entries(manifest.wayback ?? {})) {
        const key = fixtureKey(url);
        if (key && !history.has(key)) history.set(key, { dir: `brands/${slug}`, pageSlug, capturedAt: manifest.capturedAt });
      }
    }
  }
  const lookup = (url: string): { rel: string; capturedAt: string } | undefined => {
    const wb = waybackTarget(url);
    if (wb) {
      const key = fixtureKey(wb.page);
      const h = key ? history.get(key) : undefined;
      if (!h) return undefined;
      const rel = wb.timestamp ? `${h.dir}/snapshots/${h.pageSlug}/${wb.timestamp.slice(0, 8)}.html` : `${h.dir}/cdx/${h.pageSlug}.json`;
      return { rel, capturedAt: h.capturedAt };
    }
    const key = fixtureKey(url);
    return key ? map.get(key) : undefined;
  };
  return { map: (url) => lookup(url)?.rel ?? null, capturedAt: (url) => lookup(url)?.capturedAt };
}
