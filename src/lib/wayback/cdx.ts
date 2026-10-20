// Wayback Machine CDX API (brief Section 5, PLAN Phase 4 deliverable 1).
// The CDX endpoint is a brief-mandated API: it is not robots-guarded (ADR-010),
// it goes through the cached, rate-limited fetcher (≥ 1000 ms between requests).

import wayback from "../../../config/wayback.json";
import { reasons } from "../copy/wording";
import { FetchError, type FetchResult, type Fetcher } from "../fetch/fetcher";

export interface WaybackConfig {
  years: number;
  maxPages: number;
  sameClaimSimilarity: number;
  contextSentences: number;
  minIntervalMs: number;
}

export const WAYBACK_CONFIG: WaybackConfig = wayback;

export const WAYBACK_HOST = "web.archive.org";
export const CDX_ENDPOINT = `https://${WAYBACK_HOST}/cdx/search/cdx`;

/**
 * Spacing between requests to web.archive.org: WAYBACK_RATE_LIMIT_MS when it is
 * larger than the minimum, never below it (brief Section 1: ≤ 1 req/s).
 */
export function waybackIntervalMs(env: Record<string, string | undefined> = process.env, config: WaybackConfig = WAYBACK_CONFIG): number {
  const asked = Number(env.WAYBACK_RATE_LIMIT_MS);
  return Number.isFinite(asked) ? Math.max(config.minIntervalMs, asked) : config.minIntervalMs;
}

/** The years a run looks at: `years` calendar years ending with the current one. */
export function yearWindow(now: Date, config: WaybackConfig = WAYBACK_CONFIG): { from: number; to: number } {
  const to = now.getUTCFullYear();
  return { from: to - config.years + 1, to };
}

/**
 * The CDX query exactly as brief Section 5 specifies, plus `from=<year - years>`
 * (PLAN 4.1). The page URL is percent-encoded so its own query string cannot
 * leak into the CDX parameters.
 */
export function cdxUrl(pageUrl: string, now: Date, config: WaybackConfig = WAYBACK_CONFIG): string {
  const from = now.getUTCFullYear() - config.years;
  return `${CDX_ENDPOINT}?url=${encodeURIComponent(pageUrl)}&output=json&filter=statuscode:200&collapse=timestamp:4&from=${from}`;
}

/** One CDX capture row. */
export interface CdxRow {
  /** 14-digit Wayback timestamp, YYYYMMDDhhmmss (UTC). */
  timestamp: string;
  /** The URL as the archive recorded it. */
  original: string;
  statuscode: string;
  mimetype: string;
}

/** A capture chosen for the timeline (one per year). */
export interface CdxSnapshot extends CdxRow {
  year: number;
  /** ISO calendar date of the capture, YYYY-MM-DD. */
  date: string;
}

export class CdxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CdxParseError";
  }
}

const TIMESTAMP = /^\d{14}$/;

/** Parses CDX `output=json`: a header row of field names, then one row per capture. `[]` = no captures. */
export function parseCdx(body: string): CdxRow[] {
  let data: unknown;
  try {
    data = JSON.parse(body.trim() || "[]");
  } catch {
    throw new CdxParseError("CDX response is not JSON");
  }
  if (!Array.isArray(data)) throw new CdxParseError("CDX response is not a JSON array");
  if (data.length === 0) return [];
  const [header, ...rows] = data as unknown[];
  if (!Array.isArray(header) || !header.every((h) => typeof h === "string")) throw new CdxParseError("CDX header row missing");
  const col = (name: string) => header.indexOf(name);
  const iTs = col("timestamp");
  const iOrig = col("original");
  if (iTs < 0 || iOrig < 0) throw new CdxParseError("CDX header lacks timestamp/original");
  const iStatus = col("statuscode");
  const iMime = col("mimetype");
  const out: CdxRow[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const timestamp = String(row[iTs] ?? "");
    const original = String(row[iOrig] ?? "");
    if (!TIMESTAMP.test(timestamp) || !original) continue;
    out.push({
      timestamp,
      original,
      statuscode: iStatus >= 0 ? String(row[iStatus] ?? "") : "",
      mimetype: iMime >= 0 ? String(row[iMime] ?? "") : "",
    });
  }
  return out;
}

export const timestampDate = (ts: string) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;

/**
 * One snapshot per calendar year inside the window, the newest capture of each
 * year, oldest year first. Captures with a non-200 status are ignored (the
 * query already filters them; this is a second guard).
 */
export function pickYearly(rows: CdxRow[], now: Date, config: WaybackConfig = WAYBACK_CONFIG): CdxSnapshot[] {
  const { from, to } = yearWindow(now, config);
  const best = new Map<number, CdxRow>();
  for (const r of rows) {
    if (r.statuscode && r.statuscode !== "200") continue;
    const year = Number(r.timestamp.slice(0, 4));
    if (year < from || year > to) continue;
    const cur = best.get(year);
    if (!cur || r.timestamp > cur.timestamp) best.set(year, r);
  }
  return [...best.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, r]) => ({ ...r, year, date: timestampDate(r.timestamp) }));
}

/** web.archive.org could not be used for this run (connection reset, 429, 5xx). The step is skipped. */
export class WaybackUnavailableError extends Error {
  constructor(readonly detail: string) {
    super(reasons.waybackUnreachable(detail));
    this.name = "WaybackUnavailableError";
  }
}

const shortCause = (err: unknown): string => {
  if (err instanceof FetchError && err.status !== undefined) return `HTTP ${err.status}`;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/^Network error after \d+ tries: /, "").slice(0, 120) || "network error";
};

/**
 * GET against web.archive.org. A thrown fetch error, 429 or 5xx means the
 * archive is not usable right now ⇒ WaybackUnavailableError. Any other status
 * is returned to the caller.
 */
export async function waybackGet(url: string, fetcher: Fetcher): Promise<FetchResult> {
  let res: FetchResult;
  try {
    res = await fetcher.get(url);
  } catch (err) {
    throw new WaybackUnavailableError(shortCause(err));
  }
  if (res.status === 429 || res.status >= 500) throw new WaybackUnavailableError(`HTTP ${res.status}`);
  return res;
}

export interface SnapshotList {
  cdxUrl: string;
  /** HTTP status of the CDX answer; anything but 200 means no history could be read for this page. */
  status: number;
  snapshots: CdxSnapshot[];
}

/** Lists one snapshot per year for a page. Throws WaybackUnavailableError when the archive is unreachable. */
export async function listSnapshots(pageUrl: string, fetcher: Fetcher, now: Date, config: WaybackConfig = WAYBACK_CONFIG): Promise<SnapshotList> {
  const url = cdxUrl(pageUrl, now, config);
  const res = await waybackGet(url, fetcher);
  if (res.status !== 200) return { cdxUrl: url, status: res.status, snapshots: [] };
  let rows: CdxRow[];
  try {
    rows = parseCdx(res.body);
  } catch (err) {
    // An HTML error page with status 200 (maintenance, block page) is not a CDX answer.
    throw new WaybackUnavailableError(err instanceof Error ? err.message : "unreadable CDX response");
  }
  return { cdxUrl: url, status: 200, snapshots: pickYearly(rows, now, config) };
}
