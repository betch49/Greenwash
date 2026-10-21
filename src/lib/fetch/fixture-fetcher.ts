import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { FetchOptions, FetchResult, Fetcher } from "./fetcher";

/** Maps a URL to a fixture path relative to the fixture root, or null if unknown. */
export type FixtureMap = (url: string) => string | null;

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Offline fetcher: resolves URLs to files under `rootDir`. Unknown or missing ⇒ 404, never network. */
export class FixtureFetcher implements Fetcher {
  private readonly root: string;

  constructor(
    rootDir: string,
    private readonly map: FixtureMap,
    /** `fetched_at` to report for a URL (e.g. the fixture's capture date); default: now. */
    private readonly fetchedAt: (url: string) => string = () => new Date().toISOString(),
  ) {
    this.root = resolve(rootDir);
  }

  async get(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
    const rel = this.map(url);
    const notFound: FetchResult = {
      url,
      status: 404,
      body: "",
      contentType: "text/plain",
      fetchedAt: this.fetchedAt(url),
      source: "fixture",
    };
    if (!rel) return notFound;
    const file = resolve(join(this.root, rel));
    if (!file.startsWith(this.root + sep)) return notFound;
    try {
      const bytes = opts.binary ? await readFile(file) : undefined;
      const body = bytes ? "" : await readFile(file, "utf8");
      return {
        url,
        status: 200,
        body,
        ...(bytes ? { bytes } : {}),
        contentType: CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
        fetchedAt: this.fetchedAt(url),
        source: "fixture",
      };
    } catch {
      return notFound;
    }
  }
}

/** Combines several maps; the first non-null answer wins. */
export function combineMaps(...maps: FixtureMap[]): FixtureMap {
  return (url) => {
    for (const m of maps) {
      const r = m(url);
      if (r) return r;
    }
    return null;
  };
}
