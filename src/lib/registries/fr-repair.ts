// French repairability index (indice de réparabilité) on data.gouv.fr (Phase 12, ADR-027).
//
// The data.gouv.fr dataset search API lists the publishers' datasets (Etalab schema
// "schema-indice-reparabilite"). A dataset is a candidate when its publisher (organisation,
// or owner) is the brand after the ADR-019 normalisation, or when the publisher's name or the
// dataset title contains the brand as a whole word (then only rows whose
// `nom_metteur_sur_le_marche` is the brand count). Licence gate: only datasets whose licence id
// is in `config/repair.json` `frIndex.openLicences` are read; any other dataset is pointed to
// under "What we could not check" and its CSV is never fetched. Deterministic; no LLM.
import { createHash } from "node:crypto";
import config from "../../../config/repair.json";
import { couldNotCheck, reasons, signalLabels } from "../copy/wording";
import { FetchError, type Fetcher, type FetchResult } from "../fetch/fetcher";
import { RobotsDisallowedError } from "../fetch/robots";
import type { Signal } from "../pipeline/signal";
import { WEIGHTS } from "../score/weights";
import { matchEntity, normaliseEntity, tokens } from "../regulators/match";

export interface FrIndexConfig {
  apiUrl: string;
  pageSize: number;
  maxPages: number;
  ttlHours: number;
  openLicences: string[];
  lowThreshold: number;
  maxModelsInExcerpt: number;
  maxDatasetUrlsInLine: number;
  tabularCsvUrl: string;
}

export const FR_INDEX: FrIndexConfig = config.frIndex;

const HOUR_MS = 3_600_000;

/** First API page URL (later pages come from the API's own `next_page`). */
export const frApiFirstPage = (cfg: FrIndexConfig = FR_INDEX) => `${cfg.apiUrl}${cfg.apiUrl.includes("?") ? "&" : "?"}page_size=${cfg.pageSize}`;

/** The tabular-API CSV export of a resource (used when robots.txt disallows the resource URL itself). */
export const frTabularCsvUrl = (resourceId: string, cfg: FrIndexConfig = FR_INDEX) => cfg.tabularCsvUrl.replace("{rid}", encodeURIComponent(resourceId));

/** True for the data.gouv.fr URLs this module requests (the cache applies `frIndex.ttlHours` to them). */
export function isFrRepairUrl(url: string, cfg: FrIndexConfig = FR_INDEX): boolean {
  try {
    const u = new URL(url);
    const api = new URL(cfg.apiUrl);
    const tab = new URL(cfg.tabularCsvUrl.replace("{rid}", "x"));
    return (u.host === api.host && u.pathname === api.pathname) || u.host === tab.host || (u.host === "static.data.gouv.fr" && u.pathname.startsWith("/resources/"));
  } catch {
    return false;
  }
}

/** Wraps a cache TTL policy: data.gouv.fr repairability URLs get `frIndex.ttlHours`. */
export const frRepairAwareTtl =
  (inner: (url: string) => number, cfg: FrIndexConfig = FR_INDEX) =>
  (url: string): number =>
    isFrRepairUrl(url, cfg) ? cfg.ttlHours * HOUR_MS : inner(url);

// ---------------------------------------------------------------------------
// API pages

export interface FrResource {
  id: string;
  url: string;
  format: string;
  title: string;
  last_modified: string;
}

export interface FrDataset {
  id: string;
  slug: string;
  title: string;
  /** The dataset's page on www.data.gouv.fr. */
  page: string;
  license: string;
  /** The publishing organisation's name, or the owner's full name for a dataset published by a person; null if neither. */
  publisher: string | null;
  resources: FrResource[];
}

export interface FrDatasetsPage {
  datasets: FrDataset[];
  next_page: string | null;
  total: number | null;
}

/** The API answered but not with the expected JSON. */
export class FrParseError extends Error {
  constructor(readonly url: string) {
    super(reasons.frRepairUnparsable(url));
    this.name = "FrParseError";
  }
}

/** data.gouv.fr could not be used (network, status, robots). The message is the step's skipped reason. */
export class FrUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrUnavailableError";
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Parses one page of `/api/1/datasets/`. Throws FrParseError when it is not a dataset list. */
export function parseDatasetsPage(body: string, url: string): FrDatasetsPage {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new FrParseError(url);
  }
  const o = json as { data?: unknown; next_page?: unknown; total?: unknown };
  if (!o || !Array.isArray(o.data)) throw new FrParseError(url);
  const datasets: FrDataset[] = [];
  for (const raw of o.data as Record<string, unknown>[]) {
    if (!raw || typeof raw !== "object" || !str(raw.id)) continue;
    const org = raw.organization as { name?: unknown } | null | undefined;
    const owner = raw.owner as { first_name?: unknown; last_name?: unknown } | null | undefined;
    const ownerName = owner ? `${str(owner.first_name)} ${str(owner.last_name)}`.trim() : "";
    const publisher = str(org?.name).trim() || ownerName || null;
    const resources = (Array.isArray(raw.resources) ? (raw.resources as Record<string, unknown>[]) : [])
      .filter((r) => r && str(r.url))
      .map((r) => ({ id: str(r.id), url: str(r.url), format: str(r.format).toLowerCase(), title: str(r.title), last_modified: str(r.last_modified) || str(r.created_at) }));
    datasets.push({
      id: str(raw.id),
      slug: str(raw.slug),
      title: str(raw.title),
      page: str(raw.page) || `https://www.data.gouv.fr/datasets/${str(raw.slug)}`,
      license: str(raw.license) || "notspecified",
      publisher,
      resources,
    });
  }
  const next = typeof o.next_page === "string" && o.next_page ? o.next_page : null;
  return { datasets, next_page: next, total: typeof o.total === "number" ? o.total : null };
}

const causeOf = (err: unknown) => (err instanceof FetchError ? (err.status ? `HTTP ${err.status}` : err.message) : err instanceof Error ? err.message : String(err));

async function getOrUnavailable(fetcher: Fetcher, url: string): Promise<FetchResult> {
  let res: FetchResult;
  try {
    res = await fetcher.get(url, { headers: { accept: "application/json" } });
  } catch (err) {
    if (err instanceof RobotsDisallowedError) throw new FrUnavailableError(err.message);
    throw new FrUnavailableError(reasons.frRepairUnreachable(causeOf(err)));
  }
  if (res.status !== 200) throw new FrUnavailableError(reasons.frRepairUnreachable(`HTTP ${res.status}`));
  return res;
}

/**
 * Lists the repairability datasets: the first page, then `next_page` up to `maxPages` pages,
 * de-duplicated by dataset id. Any page failing ⇒ FrUnavailableError / FrParseError (the step
 * is skipped rather than reporting on a partial list).
 */
export async function listDatasets(fetcher: Fetcher, cfg: FrIndexConfig = FR_INDEX): Promise<{ datasets: FrDataset[]; pages: string[] }> {
  const seen = new Map<string, FrDataset>();
  const pages: string[] = [];
  let url: string | null = frApiFirstPage(cfg);
  while (url && pages.length < cfg.maxPages) {
    const res = await getOrUnavailable(fetcher, url);
    const page = parseDatasetsPage(res.body, url);
    pages.push(url);
    for (const d of page.datasets) if (!seen.has(d.id)) seen.set(d.id, d);
    url = page.next_page;
  }
  return { datasets: [...seen.values()], pages };
}

// ---------------------------------------------------------------------------
// CSV (Etalab schema field names)

export interface FrRow {
  id_modele: string;
  nom_modele: string;
  categorie_produit: string;
  nom_metteur_sur_le_marche: string;
  /** ISO date (YYYY-MM-DD) when the file gives one; otherwise as written. */
  date_calcul: string;
  /** 0–10; null when the cell is empty or not a number. */
  note_ir: number | null;
}

/** RFC 4180 records with the given delimiter (quoted fields, doubled quotes, CRLF or LF). */
function records(text: string, delim: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) out.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) out.push(row);
  return out;
}

/** `;` or `,`: whichever occurs more often, outside quotes, in the header line. */
export function detectDelimiter(text: string): ";" | "," {
  let semi = 0;
  let comma = 0;
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) break;
    else if (!quoted && c === ";") semi++;
    else if (!quoted && c === ",") comma++;
  }
  return semi > comma ? ";" : ",";
}

const isoDate = (s: string) => {
  const t = s.trim();
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  return iso ? iso[1] : t;
};

const score = (s: string): number | null => {
  const t = s.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 10 ? n : null;
};

const REQUIRED = ["nom_modele", "date_calcul", "note_ir"] as const;

/**
 * Parses an index CSV (UTF-8 with or without BOM, `;` or `,` delimiter) into rows keyed by the
 * Etalab schema field names. Throws FrParseError when a required column is missing.
 */
export function parseIndexCsv(text: string, url: string): FrRow[] {
  const body = text.replace(/^﻿/, "");
  const recs = records(body, detectDelimiter(body));
  if (recs.length === 0) throw new FrParseError(url);
  const header = recs[0].map((h) => h.trim().replace(/^﻿/, "").toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (REQUIRED.some((r) => col(r) < 0)) throw new FrParseError(url);
  const at = (rec: string[], name: string) => {
    const i = col(name);
    return i >= 0 ? (rec[i] ?? "").trim() : "";
  };
  return recs.slice(1).map((rec) => ({
    id_modele: at(rec, "id_modele") || at(rec, "nom_modele"),
    nom_modele: at(rec, "nom_modele"),
    categorie_produit: at(rec, "categorie_produit"),
    nom_metteur_sur_le_marche: at(rec, "nom_metteur_sur_le_marche"),
    date_calcul: isoDate(at(rec, "date_calcul")),
    note_ir: score(at(rec, "note_ir")),
  }));
}

/** The newest `date_calcul` row per `id_modele`, in order of first appearance. */
export function newestPerModel(rows: FrRow[]): FrRow[] {
  const best = new Map<string, FrRow>();
  for (const r of rows) {
    const prev = best.get(r.id_modele);
    if (!prev || r.date_calcul > prev.date_calcul) best.set(r.id_modele, r);
  }
  return [...best.values()];
}

// ---------------------------------------------------------------------------
// Matching (ADR-019)

export type FrMatch = { kind: "scored" | "possible"; entity: string } | { kind: "none" };

/**
 * scored   — the publisher's name equals the brand after normalisation ("ELECTROLUX FRANCE" ≡ "Electrolux").
 * possible — the brand is a whole word of the publisher's name ("Robert Bosch France SAS" for "Bosch")
 *            or of the dataset title; only rows naming the brand as `nom_metteur_sur_le_marche` may count.
 */
export function matchDataset(brand: string, ds: Pick<FrDataset, "publisher" | "title">): FrMatch {
  if (ds.publisher) {
    const m = matchEntity(brand, { title: ds.publisher, advertiser: ds.publisher });
    if (m !== "none") return { kind: m, entity: ds.publisher };
  }
  const b = normaliseEntity(brand);
  if (b && ` ${tokens(ds.title).join(" ")} `.includes(` ${b} `)) return { kind: "possible", entity: ds.publisher ?? ds.title };
  return { kind: "none" };
}

/** True when a row's `nom_metteur_sur_le_marche` is the brand (equality rule). */
export const rowIsBrand = (brand: string, row: FrRow) => row.nom_metteur_sur_le_marche !== "" && matchEntity(brand, { title: row.nom_metteur_sur_le_marche, advertiser: row.nom_metteur_sur_le_marche }) === "scored";

export const isOpenLicence = (licence: string, cfg: FrIndexConfig = FR_INDEX) => cfg.openLicences.includes(licence);

/** The newest CSV resource of a dataset (by `last_modified`), or null. */
export function newestCsv(ds: FrDataset): FrResource | null {
  const csvs = ds.resources.filter((r) => r.format === "csv" || /\.csv(\?|$)/i.test(r.url));
  if (csvs.length === 0) return null;
  return csvs.reduce((a, b) => (b.last_modified > a.last_modified ? b : a));
}

// ---------------------------------------------------------------------------
// The check

export interface FrRepairResult {
  signals: Signal[];
  could_not_check: string[];
  /** Number of datasets listed by the API. */
  listed: number;
  /** Datasets that could not be parsed (the step reports the first when no signal came out). */
  parseFailures: string[];
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

function signal(kind: "repair.fr_index_found" | "repair.fr_index_low", label: string, url: string, fetchedAt: string, excerpt: string, entity: string): Signal {
  return { id: `repair-${kind.replace(/^repair\./, "")}-${hash(`${url} ${excerpt}`)}`, axis: "repair", kind, label, weight_hint: WEIGHTS.defaultWeightHint, source_url: url, fetched_at: fetchedAt, excerpt, entity_name: entity, llm_used: false };
}

/** Receipt excerpt: up to `maxModelsInExcerpt` models with their published scores, the licence id and the dataset page. */
export function frExcerpt(entity: string, rows: FrRow[], ds: Pick<FrDataset, "license" | "page">, cfg: FrIndexConfig = FR_INDEX): string {
  const shown = rows.slice(0, cfg.maxModelsInExcerpt).map((r) => `${r.nom_modele}${r.categorie_produit ? ` (${r.categorie_produit})` : ""} ${r.note_ir === null ? "no score" : `${r.note_ir}/10`}, calculated ${r.date_calcul}`);
  const more = rows.length - shown.length;
  return `${entity}: ${shown.join("; ")}${more > 0 ? `; and ${more} more ${more === 1 ? "model" : "models"}` : ""}. Licence: ${ds.license}. Dataset: ${ds.page}`;
}

/** Fetches a CSV: the resource URL, or the tabular-API export when robots.txt disallows the resource URL. */
async function fetchCsv(fetcher: Fetcher, res: FrResource, cfg: FrIndexConfig): Promise<FetchResult> {
  try {
    return await fetcher.get(res.url, { headers: { accept: "text/csv" } });
  } catch (err) {
    if (!(err instanceof RobotsDisallowedError) || !res.id) throw err;
    return await fetcher.get(frTabularCsvUrl(res.id, cfg), { headers: { accept: "text/csv" } });
  }
}

/**
 * Looks the brand up in the French repairability index. Throws FrUnavailableError or FrParseError
 * when the dataset list itself cannot be read (the step is then skipped with that reason).
 */
export async function checkFrRepair(brand: string, fetcher: Fetcher, cfg: FrIndexConfig = FR_INDEX): Promise<FrRepairResult> {
  const { datasets } = await listDatasets(fetcher, cfg);
  const out: FrRepairResult = { signals: [], could_not_check: [], listed: datasets.length, parseFailures: [] };
  const gated = new Map<string, { publisher: string; licence: string; urls: string[] }>();
  let candidates = 0;
  for (const ds of datasets) {
    const m = matchDataset(brand, ds);
    if (m.kind === "none") continue;
    candidates++;
    if (!isOpenLicence(ds.license, cfg)) {
      // Licence gate: pointed to, never fetched, never excerpted.
      if (m.kind === "possible") {
        out.could_not_check.push(couldNotCheck.frRepairPossible(m.entity, ds.page));
        continue;
      }
      const key = `${m.entity}\u0000${ds.license}`;
      const g = gated.get(key) ?? { publisher: m.entity, licence: ds.license, urls: [] };
      if (!g.urls.includes(ds.page)) g.urls.push(ds.page);
      gated.set(key, g);
      continue;
    }
    const csv = newestCsv(ds);
    if (!csv) {
      if (m.kind === "scored") out.could_not_check.push(couldNotCheck.frRepairNoCsv(ds.page));
      else out.could_not_check.push(couldNotCheck.frRepairPossible(m.entity, ds.page));
      continue;
    }
    let res: FetchResult;
    try {
      res = await fetchCsv(fetcher, csv, cfg);
    } catch (err) {
      out.could_not_check.push(couldNotCheck.frRepairCsvNotRead(csv.url, err instanceof RobotsDisallowedError ? err.message : reasons.frRepairUnreachable(causeOf(err))));
      continue;
    }
    if (res.status !== 200) {
      out.could_not_check.push(couldNotCheck.frRepairCsvNotRead(res.url, reasons.frRepairUnreachable(`HTTP ${res.status}`)));
      continue;
    }
    let rows: FrRow[];
    try {
      rows = parseIndexCsv(res.body, res.url);
    } catch (err) {
      if (!(err instanceof FrParseError)) throw err;
      out.parseFailures.push(err.message);
      out.could_not_check.push(couldNotCheck.frRepairSkipped(err.message));
      continue;
    }
    let entity = m.entity;
    if (m.kind === "possible") {
      rows = rows.filter((r) => rowIsBrand(brand, r));
      if (rows.length === 0) {
        out.could_not_check.push(couldNotCheck.frRepairPossible(m.entity, ds.page));
        continue;
      }
      entity = rows[0].nom_metteur_sur_le_marche;
    }
    const kept = newestPerModel(rows);
    const scored = kept.filter((r) => r.note_ir !== null);
    if (scored.length === 0) {
      out.parseFailures.push(reasons.frRepairUnparsable(res.url));
      out.could_not_check.push(couldNotCheck.frRepairSkipped(reasons.frRepairUnparsable(res.url)));
      continue;
    }
    const mean = scored.reduce((a, r) => a + (r.note_ir as number), 0) / scored.length;
    const excerpt = frExcerpt(entity, kept, ds, cfg);
    // One signal per dataset: the protective kind, or the risk kind instead of it when the mean is below the threshold.
    out.signals.push(
      mean < cfg.lowThreshold
        ? signal("repair.fr_index_low", signalLabels.frIndexLow(scored.length, fmt(mean), fmt(cfg.lowThreshold)), res.url, res.fetchedAt, excerpt, entity)
        : signal("repair.fr_index_found", signalLabels.frIndexFound(scored.length, fmt(mean)), res.url, res.fetchedAt, excerpt, entity),
    );
  }
  for (const g of gated.values()) {
    const shown = g.urls.slice(0, cfg.maxDatasetUrlsInLine);
    out.could_not_check.push(couldNotCheck.frRepairGated(g.publisher, g.licence, shown, g.urls.length - shown.length));
  }
  if (candidates === 0) out.could_not_check.push(couldNotCheck.frRepairNone(datasets.length));
  return out;
}
