// The Signal type (brief Section 5, PLAN conventions) and the receipt guard.

export type Axis = "claims" | "evidence" | "track" | "repair";

export interface Signal {
  id: string;
  axis: Axis;
  kind: string;
  label: string;
  weight_hint: number;
  source_url: string;
  /** ISO 8601 time of the fetch that produced the excerpt. */
  fetched_at: string;
  excerpt: string;
  snapshot_date?: string;
  entity_name?: string;
  llm_used: boolean;
}

export class ReceiptError extends Error {
  constructor(
    message: string,
    readonly signal: unknown,
  ) {
    super(message);
    this.name = "ReceiptError";
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Returns the reason a value is not a receipted signal, or null when it is one. */
export function receiptProblem(s: Partial<Signal> | null | undefined): string | null {
  if (!s) return "signal is empty";
  if (typeof s.source_url !== "string" || !s.source_url.trim()) return "missing source_url";
  let url: URL;
  try {
    url = new URL(s.source_url);
  } catch {
    return `source_url is not an absolute URL: ${s.source_url}`;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return `source_url is not http(s): ${s.source_url}`;
  if (typeof s.fetched_at !== "string" || !s.fetched_at.trim()) return "missing fetched_at";
  if (!ISO_DATE.test(s.fetched_at) || Number.isNaN(Date.parse(s.fetched_at))) {
    return `fetched_at is not an ISO date-time: ${s.fetched_at}`;
  }
  if (typeof s.excerpt !== "string" || !s.excerpt.trim()) return "empty excerpt";
  return null;
}

/**
 * Throws ReceiptError unless the signal has a source URL, a fetch date and a
 * non-empty excerpt. A signal without a receipt is never stored, shown or scored.
 */
export function assertReceipt(s: Partial<Signal> | null | undefined): asserts s is Signal {
  const problem = receiptProblem(s);
  if (problem) throw new ReceiptError(`signal rejected: ${problem}`, s);
}

/** Keeps only receipted signals. */
export function withReceipts<T extends Partial<Signal>>(signals: T[]): (T & Signal)[] {
  return signals.filter((s): s is T & Signal => receiptProblem(s) === null);
}
