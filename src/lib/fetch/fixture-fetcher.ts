import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { FetchResult, Fetcher } from "./fetcher";

/** Maps a URL to a fixture path relative to the fixture root, or null if unknown. */
export type FixtureMap = (url: string) => string | null;

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".xml": "application/xml",
  ".txt": "text/plain",
};

/** Offline fetcher: resolves URLs to files under `rootDir`. Unknown or missing ⇒ 404, never network. */
export class FixtureFetcher implements Fetcher {
  private readonly root: string;

  constructor(
    rootDir: string,
    private readonly map: FixtureMap,
    private readonly fetchedAt: () => string = () => new Date().toISOString(),
  ) {
    this.root = resolve(rootDir);
  }

  async get(url: string): Promise<FetchResult> {
    const rel = this.map(url);
    const notFound: FetchResult = {
      url,
      status: 404,
      body: "",
      contentType: "text/plain",
      fetchedAt: this.fetchedAt(),
      source: "fixture",
    };
    if (!rel) return notFound;
    const file = resolve(join(this.root, rel));
    if (!file.startsWith(this.root + sep)) return notFound;
    try {
      const body = await readFile(file, "utf8");
      return {
        url,
        status: 200,
        body,
        contentType: CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
        fetchedAt: this.fetchedAt(),
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
