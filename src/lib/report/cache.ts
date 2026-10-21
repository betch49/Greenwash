// Re-serving a stored report (PLAN Phase 8 deliverable 2; brief Section 1: a
// known brand is served from cache in under a second). A new search for a
// website with a report younger than GR_REPORT_TTL_HOURS (default 168) goes to
// that report; the pipeline does not run again unless the user asks ("Re-run").

import type { ReportsRepo } from "../db/reports-repo";
import { normaliseWebsite } from "../website";

export const DEFAULT_REPORT_TTL_HOURS = 168;
const HOUR_MS = 3_600_000;

/** GR_REPORT_TTL_HOURS as a number of hours (≥ 0); unset or unusable ⇒ the default. 0 turns re-serving off. */
export function reportTtlHours(env: Record<string, string | undefined> = process.env): number {
  const raw = env.GR_REPORT_TTL_HOURS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_REPORT_TTL_HOURS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_REPORT_TTL_HOURS;
}

/**
 * The spellings of one website that count as the same site: as given, and
 * normalised with and without a trailing slash ("https://www.oatly.com/" from
 * Wikidata and "https://www.oatly.com" pasted by a user are one site).
 */
export function websiteKeys(website: string): string[] {
  const n = normaliseWebsite(website);
  return [...new Set([website, ...(n ? [n, `${n}/`] : [])])];
}

export interface BrandIdentity {
  website: string;
  /** The confirmed Wikidata entity; null/absent for a pasted website (then `brand` is the typed name). */
  wikidataId?: string | null;
  brand?: string;
}

/** The id of the newest report for this brand identity younger than `ttlHours` at `now`, if any. */
export function freshReportId(reports: Pick<ReportsRepo, "findFresh">, who: BrandIdentity, now: Date, ttlHours: number): string | undefined {
  if (ttlHours <= 0) return undefined;
  const notBefore = new Date(now.getTime() - ttlHours * HOUR_MS).toISOString();
  return reports.findFresh(websiteKeys(who.website), notBefore, { wikidataId: who.wikidataId ?? null, brand: who.brand })?.id;
}
