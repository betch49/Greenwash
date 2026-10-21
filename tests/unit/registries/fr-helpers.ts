import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FR_INDEX, frApiFirstPage, type FrIndexConfig } from "@/lib/registries/fr-repair";
import type { FetchResult, Fetcher } from "@/lib/fetch/fetcher";

export const FR_DIR = join("fixtures", "sources", "fr-repair");

export interface FrManifest {
  cases: string[];
  files: Record<string, { file: string; capturedAt: string; original?: { bytes: number; sha256: string } }>;
}

export const frManifest = () => JSON.parse(readFileSync(join(FR_DIR, "manifest.json"), "utf8")) as FrManifest;

/** A recorded fr-repair response by URL. */
export function frSource(url: string): string {
  const e = frManifest().files[url];
  if (!e) throw new Error(`no recorded fr-repair source for ${url}`);
  return readFileSync(join(FR_DIR, e.file), "utf8");
}

export const FAIRPHONE_RESOURCE = "5207fe39-1c14-4a40-8301-c84dc9b9a839";
export const FAIRPHONE_TABULAR = `https://tabular-api.data.gouv.fr/api/resources/${FAIRPHONE_RESOURCE}/data/csv/`;
export const FAIRPHONE_STATIC = "https://static.data.gouv.fr/resources/indice-de-reparabilite-organisation-fairphone-1/20250708-084159/fp6-repairability-donnees-indice-reparabilite-fairphone-2-.csv";
export const FAIRPHONE_PAGE = "https://www.data.gouv.fr/datasets/indice-de-reparabilite-organisation-fairphone-1";
export const ELECTROLUX_PAGE = "https://www.data.gouv.fr/datasets/indice-de-reparabilite-electrolux-france";

/** In-memory fetcher (URL ⇒ body, 200; else 404) that logs every call. */
export class LogFetcher implements Fetcher {
  readonly calls: string[] = [];
  constructor(private readonly files: Record<string, string>) {}
  async get(url: string): Promise<FetchResult> {
    this.calls.push(url);
    const body = this.files[url];
    return { url, status: body === undefined ? 404 : 200, body: body ?? "", contentType: "text/plain", fetchedAt: "2026-10-21T08:00:00.000Z", source: "fixture" };
  }
}

/** A synthetic one-dataset API page (fictional `.example` publishers only, ADR-011). */
export function syntheticApiPage(datasets: { id: string; publisher: string; license: string; csvUrl: string; title?: string }[]): string {
  return JSON.stringify({
    data: datasets.map((d) => ({
      id: d.id,
      slug: `indice-${d.id}`,
      title: d.title ?? `Indice de réparabilité (${d.publisher})`,
      page: `https://www.data.gouv.fr/datasets/indice-${d.id}`,
      license: d.license,
      organization: { name: d.publisher },
      owner: null,
      resources: [{ id: `r-${d.id}`, url: d.csvUrl, format: "csv", title: "data", last_modified: "2026-01-01T00:00:00+00:00" }],
    })),
    next_page: null,
    total: datasets.length,
  });
}

export const firstPage = (cfg: FrIndexConfig = FR_INDEX) => frApiFirstPage(cfg);
