import { createHash } from "node:crypto";
import config from "../../../config/regulators.json";
import weights from "../../../config/weights.json";
import { couldNotCheck, signalLabels, steps } from "../copy/wording";
import type { ProgressEntry } from "../db/runs-repo";
import type { Fetcher } from "../fetch/fetcher";
import type { Signal } from "../pipeline/signal";
import { RegulatorUnavailableError, type RegulatorAdapter, type Ruling, type RulingCandidate } from "./adapter";
import { matchEntity } from "./match";

/** A ruling whose entity name contains the brand but is not the brand: shown, never scored, never a signal. */
export interface PossibleMatch {
  regulator: RegulatorAdapter["id"];
  url: string;
  title: string;
  /** The ruled entity, verbatim. */
  entity_name: string;
  date?: string;
  outcome?: string;
  scored: false;
}

export interface RegulatorCheck {
  signals: Signal[];
  rulings: Ruling[];
  possible: PossibleMatch[];
  could_not_check: string[];
  progress: ProgressEntry[];
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

/**
 * weight_hint for a ruling (PLAN Phase 5 deliverable 4, values in config/weights.json):
 * base × upheldMultiplier when upheld × recentMultiplier when dated within recentYears of `now`.
 */
export function rulingWeightHint(ruling: Pick<Ruling, "outcome" | "date">, now: Date, w = weights.regulatorRuling): number {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - w.recentYears);
  const recent = Date.parse(`${ruling.date}T00:00:00Z`) >= cutoff.getTime();
  return w.baseHint * (ruling.outcome === "upheld" ? w.upheldMultiplier : 1) * (recent ? w.recentMultiplier : 1);
}

export function rulingSignal(adapter: Pick<RegulatorAdapter, "id" | "name" | "country">, ruling: Ruling, now: Date): Signal {
  return {
    id: `regulator-${adapter.id}-${hash(ruling.url)}`,
    axis: "track",
    kind: "regulator.ruling",
    label: signalLabels.rulingFound(ruling.advertiser, adapter.name, adapter.country, ruling.date, ruling.outcomeText || ruling.outcome),
    weight_hint: rulingWeightHint(ruling, now),
    source_url: ruling.url,
    fetched_at: ruling.fetchedAt,
    excerpt: ruling.excerpt,
    entity_name: ruling.advertiser,
    llm_used: false,
  };
}

/**
 * Searches one regulator for the brand and reads the rulings whose listed name
 * matches (scored first, then possible; at most `maxRulings` pages). A hit whose
 * listed name does not even contain the brand as a whole word is never fetched.
 * The search itself failing throws RegulatorUnavailableError (the step is skipped);
 * one ruling page failing is a progress line and a could-not-check line.
 */
export async function checkRegulator(
  adapter: RegulatorAdapter,
  brand: string,
  fetcher: Fetcher,
  now: Date,
  maxRulings: number = config.maxRulings,
): Promise<RegulatorCheck> {
  const out: RegulatorCheck = { signals: [], rulings: [], possible: [], could_not_check: [], progress: [] };
  const hits = await adapter.search(brand, fetcher);
  const ranked: RulingCandidate[] = [
    ...hits.filter((h) => matchEntity(brand, { title: h.title }) === "scored"),
    ...hits.filter((h) => matchEntity(brand, { title: h.title }) === "possible"),
  ].slice(0, maxRulings);
  for (const hit of ranked) {
    let ruling: Ruling;
    try {
      ruling = await adapter.fetchRuling(hit.url, fetcher);
    } catch (err) {
      if (!(err instanceof RegulatorUnavailableError)) throw err;
      out.progress.push({ step: steps.fetchRuling(hit.url), status: "skipped", reason: err.message });
      out.could_not_check.push(couldNotCheck.regulatorRulingSkipped(hit.url, err.message));
      continue;
    }
    const kind = matchEntity(brand, { title: ruling.title, advertiser: ruling.advertiser });
    if (kind === "scored") {
      out.rulings.push(ruling);
      out.signals.push(rulingSignal(adapter, ruling, now));
    } else if (kind === "possible") {
      out.possible.push({ regulator: adapter.id, url: ruling.url, title: ruling.title, entity_name: ruling.advertiser, date: ruling.date, outcome: ruling.outcomeText, scored: false });
      out.could_not_check.push(couldNotCheck.regulatorPossible(adapter.name, ruling.advertiser, ruling.url));
    }
  }
  return out;
}

