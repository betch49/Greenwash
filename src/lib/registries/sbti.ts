// SBTi Target Dashboard companies export (Phase 11, ADR-026, docs/SOURCES.md).
// Reads the public .xlsx export, matches the brand with the ADR-019 equality rule
// (or ISIN/LEI equality with the Wikidata entity) and turns the matched rows into
// deterministic track-record signals. No LLM is involved; points live in
// config/weights.json only.
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import registries from "../../../config/registries.json";
import { sbtiWording } from "../copy/wording";
import type { Signal } from "../pipeline/signal";
import { matchEntity } from "../regulators/match";
import { WEIGHTS, type Weights } from "../score/weights";

export const SBTI_CONFIG = registries.sbti;

/** The 12 fields read from each export row (PLAN Phase 11 deliverable 1). */
export interface SbtiRow {
  company_name: string;
  isin: string;
  lei: string;
  location: string;
  sector: string;
  near_term_status: string;
  near_term_target_year: string;
  net_zero_status: string;
  net_zero_year: string;
  status_reason: string;
  /** ISO date (YYYY-MM-DD), converted from the Excel date cell or serial; "" when absent. */
  date_updated: string;
  full_target_language: string;
}

export const SBTI_FIELDS = [
  "company_name",
  "isin",
  "lei",
  "location",
  "sector",
  "near_term_status",
  "near_term_target_year",
  "net_zero_status",
  "net_zero_year",
  "status_reason",
  "date_updated",
  "full_target_language",
] as const satisfies readonly (keyof SbtiRow)[];

/** Columns without which the export cannot be read. */
const REQUIRED = ["company_name", "near_term_status", "net_zero_status", "status_reason", "date_updated"] as const;

export const STATUS = {
  removed: "Commitment Removed",
  validated: "Validated Targets",
  pending: "Commitment to Set Targets",
} as const;

export const EXPIRED_REASON = "Expired commitment";

export class SbtiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SbtiParseError";
  }
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/** Excel serial date (days since 1899-12-30, the 1900 system) ⇒ ISO date. */
export function excelSerialToIso(serial: number): string {
  return new Date(EXCEL_EPOCH_MS + Math.round(serial * DAY_MS)).toISOString().slice(0, 10);
}

/** Plain text of an exceljs cell value (string, number, rich text, hyperlink, formula result, date). */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; text?: unknown; result?: unknown };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("").trim();
    if (o.text !== undefined) return cellText(o.text);
    if (o.result !== undefined) return cellText(o.result);
  }
  return "";
}

/** The date_updated cell as an ISO date: a Date cell, an Excel serial, or an ISO-like string. */
function cellDate(v: unknown): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "number" && Number.isFinite(v)) return excelSerialToIso(v);
  const s = cellText(v);
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

/** Parses the export's first worksheet (header row 1) into rows. Throws SbtiParseError when it is not the export. */
export async function parseSbtiExport(bytes: Buffer | Uint8Array): Promise<SbtiRow[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof wb.xlsx.load>[0]);
  } catch (err) {
    throw new SbtiParseError(`not a readable .xlsx file (${err instanceof Error ? err.message : String(err)})`);
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new SbtiParseError("the workbook has no worksheet");
  const header = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => header.set(cellText(cell.value), col));
  const missing = REQUIRED.filter((k) => !header.has(k));
  if (missing.length) throw new SbtiParseError(`missing columns: ${missing.join(", ")}`);
  const rows: SbtiRow[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const get = (k: string) => {
      const col = header.get(k);
      return col ? row.getCell(col).value : undefined;
    };
    const out = {} as SbtiRow;
    for (const f of SBTI_FIELDS) out[f] = f === "date_updated" ? cellDate(get(f)) : cellText(get(f));
    if (out.company_name) rows.push(out);
  });
  return rows;
}

const memo = new Map<string, Promise<SbtiRow[]>>();

/** parseSbtiExport, memoised per (url, fetch time, size): the 15k-row export is parsed once per cached copy. */
export function loadSbtiRows(key: { url: string; fetchedAt: string }, bytes: Buffer): Promise<SbtiRow[]> {
  const k = `${key.url}|${key.fetchedAt}|${bytes.length}`;
  let p = memo.get(k);
  if (!p) {
    if (memo.size >= 2) memo.clear();
    p = parseSbtiExport(bytes);
    memo.set(k, p);
    p.catch(() => memo.delete(k));
  }
  return p;
}

/** ISIN (P946) and LEI (P1278) of the confirmed Wikidata entity, when it has any. */
export interface EntityIds {
  isins: string[];
  leis: string[];
}

export function entityIds(entity: unknown): EntityIds {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim().toUpperCase()) : []);
  const e = (entity && typeof entity === "object" ? entity : {}) as { isins?: unknown; leis?: unknown };
  return { isins: list(e.isins), leis: list(e.leis) };
}

export interface SbtiLookup {
  /** Rows attributed to the brand: name equality (ADR-019) or ISIN/LEI equality. */
  scored: SbtiRow[];
  /** Rows whose name only contains the brand as a whole word: shown, never scored. */
  possible: SbtiRow[];
}

/** ADR-019 three-way rule on company_name, plus identifier equality with the Wikidata entity. */
export function lookupSbti(brand: string, rows: SbtiRow[], ids: EntityIds = { isins: [], leis: [] }): SbtiLookup {
  const out: SbtiLookup = { scored: [], possible: [] };
  for (const r of rows) {
    const idMatch = (r.isin !== "" && ids.isins.includes(r.isin.toUpperCase())) || (r.lei !== "" && ids.leis.includes(r.lei.toUpperCase()));
    const kind = matchEntity(brand, { title: r.company_name });
    if (idMatch || kind === "scored") out.scored.push(r);
    else if (kind === "possible") out.possible.push(r);
  }
  return out;
}

/** The status_reason items ("Expired commitment; Target set at parent company level" ⇒ two). */
export const reasonItems = (reason: string) =>
  reason
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

/** A removal is neutral (status note, 0 points) only when every listed reason is in config neutralReasons. */
export function isNeutralRemoval(reason: string, neutral: readonly string[] = SBTI_CONFIG.neutralReasons): boolean {
  const items = reasonItems(reason);
  return items.length > 0 && items.every((i) => neutral.includes(i));
}

/**
 * weight_hint of a removal: defaultWeightHint × regulatorRuling.recentMultiplier when date_updated is within
 * regulatorRuling.recentYears of `now` × sbti.expiredMultiplier when a reason is "Expired commitment".
 */
export function removalWeightHint(row: Pick<SbtiRow, "date_updated" | "status_reason">, now: Date, w: Weights = WEIGHTS): number {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - w.regulatorRuling.recentYears);
  const recent = row.date_updated !== "" && Date.parse(`${row.date_updated}T00:00:00Z`) >= cutoff.getTime();
  const expired = reasonItems(row.status_reason).includes(EXPIRED_REASON);
  return w.defaultWeightHint * (recent ? w.regulatorRuling.recentMultiplier : 1) * (expired ? w.sbti.expiredMultiplier : 1);
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

export interface ExportReceipt {
  url: string;
  /** ISO time of the export fetch (the cache keeps the original). */
  fetchedAt: string;
}

/** Signals for one matched row (PLAN Phase 11 deliverable 2). Every one has llm_used: false. */
export function sbtiSignals(row: SbtiRow, receipt: ExportReceipt, now: Date, w: Weights = WEIGHTS): Signal[] {
  const exportDate = receipt.fetchedAt.slice(0, 10);
  const base = {
    axis: "track" as const,
    source_url: receipt.url,
    fetched_at: receipt.fetchedAt,
    excerpt: sbtiWording.excerpt(row, exportDate),
    entity_name: row.company_name,
    llm_used: false,
  };
  const id = (kind: string) => `sbti-${kind.replace("sbti.", "")}-${hash(`${row.company_name}|${row.isin}|${row.lei}`)}`;
  const out: Signal[] = [];
  const removed = [row.near_term_status === STATUS.removed ? "near-term" : "", row.net_zero_status === STATUS.removed ? "net-zero" : ""].filter(Boolean);
  if (removed.length) {
    if (isNeutralRemoval(row.status_reason)) {
      out.push({ ...base, id: id("sbti.status_note"), kind: "sbti.status_note", label: sbtiWording.statusNote(row.company_name, row.status_reason), weight_hint: w.defaultWeightHint });
    } else {
      out.push({
        ...base,
        id: id("sbti.commitment_removed"),
        kind: "sbti.commitment_removed",
        label: sbtiWording.commitmentRemoved(row.company_name, removed.join(" and "), row.status_reason, row.date_updated),
        weight_hint: removalWeightHint(row, now, w),
      });
    }
  }
  if (row.near_term_status === STATUS.validated) {
    out.push({ ...base, id: id("sbti.targets_validated"), kind: "sbti.targets_validated", label: sbtiWording.targetsValidated(row.company_name, row.near_term_target_year), weight_hint: w.defaultWeightHint });
  }
  const pending = [row.near_term_status === STATUS.pending ? "near-term" : "", row.net_zero_status === STATUS.pending ? "net-zero" : ""].filter(Boolean);
  if (pending.length) {
    out.push({ ...base, id: id("sbti.commitment_pending"), kind: "sbti.commitment_pending", label: sbtiWording.commitmentPending(row.company_name, pending.join(" and ")), weight_hint: w.defaultWeightHint });
  }
  return out;
}

/** "near-term Validated Targets, net-zero none listed": the statuses of a possible match, verbatim. */
export const statusSummary = (r: Pick<SbtiRow, "near_term_status" | "net_zero_status">) =>
  `near-term ${r.near_term_status || "none listed"}, net-zero ${r.net_zero_status || "none listed"}`;
