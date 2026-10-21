// Raw Wayback snapshots (brief Section 5, PLAN Phase 4 deliverable 2).
// `id_` returns the page as archived, without the Wayback toolbar or URL rewriting.

import { visibleText } from "../discover/visible-text";
import type { Fetcher } from "../fetch/fetcher";
import { WAYBACK_HOST, waybackGet, type CdxSnapshot } from "./cdx";

/** `https://web.archive.org/web/<ts>id_/<url>`. */
export const snapshotUrl = (timestamp: string, original: string) => `https://${WAYBACK_HOST}/web/${timestamp}id_/${original}`;

const SNAPSHOT_PATH = /^\/web\/(\d{14})id_\/(.+)$/;

/** Parses a raw-snapshot URL into its timestamp and original URL, or null. */
export function parseSnapshotUrl(url: string): { timestamp: string; original: string } | null {
  try {
    const u = new URL(url);
    if (u.host !== WAYBACK_HOST) return null;
    const m = SNAPSHOT_PATH.exec(u.pathname + u.search);
    return m ? { timestamp: m[1], original: m[2] } : null;
  } catch {
    return null;
  }
}

/** An archived capture never changes, so a cached snapshot never expires (PLAN 4 deliverable 2). */
export const isSnapshotUrl = (url: string) => parseSnapshotUrl(url) !== null;

/** Cache policy for the shared CachedFetcher: snapshots forever, everything else the default TTL. */
export const waybackAwareTtl =
  (defaultTtlMs: number) =>
  (url: string): number =>
    isSnapshotUrl(url) ? Infinity : defaultTtlMs;

/** A fetched snapshot reduced to its visible text (nav/header/footer stripped, as for live pages). */
export interface Snapshot {
  /** The brand page this is a history of. */
  pageUrl: string;
  timestamp: string;
  year: number;
  /** YYYY-MM-DD of the capture. */
  date: string;
  /** The `id_` URL: the receipt for anything found in this snapshot. */
  snapshotUrl: string;
  original: string;
  title: string;
  text: string;
  /** When we fetched the snapshot (served from cache: the original fetch time). */
  fetchedAt: string;
  /**
   * ADR-017: the page as fetched live, appended as the last element of its
   * history (year = the run's year, snapshotUrl = the page URL). It is never a
   * receipt for a removal: the receipt is always the archived copy before it.
   */
  live?: boolean;
}

export type SnapshotFetch = { ok: true; snapshot: Snapshot } | { ok: false; url: string; status: number };

/**
 * Fetches one snapshot through `fetcher` (the cached, rate-limited one).
 * Throws WaybackUnavailableError on a network error, 429 or 5xx; any other
 * non-200 status is returned so the caller can list it as skipped.
 */
export async function fetchSnapshot(pageUrl: string, snap: CdxSnapshot, fetcher: Fetcher): Promise<SnapshotFetch> {
  const url = snapshotUrl(snap.timestamp, snap.original);
  const res = await waybackGet(url, fetcher);
  if (res.status !== 200) return { ok: false, url, status: res.status };
  const v = visibleText(res.body, snap.original);
  return {
    ok: true,
    snapshot: {
      pageUrl,
      timestamp: snap.timestamp,
      year: snap.year,
      date: snap.date,
      snapshotUrl: url,
      original: snap.original,
      title: v.title,
      text: v.text,
      fetchedAt: res.fetchedAt,
    },
  };
}
