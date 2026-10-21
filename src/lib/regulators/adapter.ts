// Regulator adapters (Phase 5, differentiator C, ADR-003). Each adapter is a
// search page + a ruling page parser behind one interface, so more countries can
// be added without touching the pipeline (docs/LATER.md lists the next ones).
import { FetchError, type FetchResult, type Fetcher } from "../fetch/fetcher";
import { RobotsDisallowedError } from "../fetch/robots";
import { reasons } from "../copy/wording";

export type RulingOutcome = "upheld" | "not_upheld" | "informally_resolved" | "unknown";

/** One search hit that links to a ruling page. */
export interface RulingCandidate {
  url: string;
  /** The hit's title as listed (usually the ruled entity's name). */
  title: string;
  /** Date as listed, ISO YYYY-MM-DD, when the listing gives one. */
  date?: string;
  /** Outcome words as listed, verbatim. */
  outcomeText?: string;
}

/** A parsed ruling page. */
export interface Ruling {
  url: string;
  title: string;
  /** The ruled entity, verbatim from the page. */
  advertiser: string;
  /** ISO YYYY-MM-DD. */
  date: string;
  outcome: RulingOutcome;
  /** The outcome words on the page, verbatim ("Upheld in part", "Plainte fondée après révision"). */
  outcomeText: string;
  /** Set when the outcome is partial ("upheld in part", "partiellement fondée"): mapped to `upheld` with this note. */
  note?: string;
  /** First characters of the ruling summary (the receipt excerpt). */
  excerpt: string;
  fetchedAt: string;
}

export interface RegulatorAdapter {
  id: "asa-uk" | "jdp-fr";
  /** Short regulator name shown in labels ("ASA"). */
  name: string;
  country: string;
  searchUrl(brand: string): string;
  search(brand: string, fetcher: Fetcher): Promise<RulingCandidate[]>;
  fetchRuling(url: string, fetcher: Fetcher): Promise<Ruling>;
}

/** The regulator's site could not be used: unreachable, robots.txt, or a page we cannot parse. The step is skipped with this message. */
export class RegulatorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegulatorUnavailableError";
  }
}

/** A page that answered 200 but does not have the structure the parser knows. */
export class RegulatorParseError extends RegulatorUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = "RegulatorParseError";
  }
}

/**
 * Fetches a regulator page and turns every failure into a RegulatorUnavailableError
 * whose message is the shown skip reason: robots (verbatim), "<name> unreachable (HTTP 500)",
 * "<name> unreachable (<network error>)".
 */
export async function getRegulatorPage(fetcher: Fetcher, url: string, name: string): Promise<FetchResult> {
  let res: FetchResult;
  try {
    res = await fetcher.get(url, { headers: { accept: "text/html" } });
  } catch (err) {
    if (err instanceof RobotsDisallowedError) throw new RegulatorUnavailableError(err.message);
    if (err instanceof FetchError) throw new RegulatorUnavailableError(reasons.regulatorUnreachable(name, err.status ? `HTTP ${err.status}` : err.message));
    throw new RegulatorUnavailableError(reasons.regulatorUnreachable(name, err instanceof Error ? err.message : String(err)));
  }
  if (res.status !== 200) throw new RegulatorUnavailableError(reasons.regulatorUnreachable(name, `HTTP ${res.status}`));
  return res;
}

const EN_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const FR_MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** "26 January 2022" / "11 décembre 2024" / "1er mars 2023" ⇒ "2022-01-26"; null when no such date is in the text. */
export function parseDayMonthYear(text: string): string | null {
  const m = /(\d{1,2})(?:er)?\s+([a-zA-Zéûèô]+)\s+(\d{4})/u.exec(text);
  if (!m) return null;
  const month = fold(m[2]);
  const idx = EN_MONTHS.indexOf(month) >= 0 ? EN_MONTHS.indexOf(month) : FR_MONTHS.indexOf(month);
  if (idx < 0) return null;
  const day = Number(m[1]);
  if (day < 1 || day > 31) return null;
  return iso(Number(m[3]), idx + 1, day);
}

export const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** First `max` characters of a text, cut at a word boundary, with an ellipsis when cut. */
export function firstChars(text: string, max: number): string {
  const t = collapse(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Excerpt length for a ruling receipt (PLAN Phase 5 deliverable 4: first 300 chars of the summary). */
export const RULING_EXCERPT_CHARS = 300;
