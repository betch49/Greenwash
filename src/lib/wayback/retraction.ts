// Claim retraction detector (differentiator A, PLAN Phase 4 deliverable 4).
// Deterministic: a removed sentence counts only if a Phase 3 claim rule matches
// it and nothing close to it (similarity ≥ threshold) is in the later snapshot.
// llm_used is always false here; Phase 7 may only downgrade a candidate.

import { createHash } from "node:crypto";
import { DEFAULT_WEIGHT_HINT, classify, excerptOf } from "../claims/engine";
import type { RuleId } from "../claims/rules";
import { splitSentences } from "../claims/split";
import { signalLabels } from "../copy/wording";
import type { Signal } from "../pipeline/signal";
import { WAYBACK_CONFIG, type WaybackConfig } from "./cdx";
import { diffSentences, normaliseSentence, similarity } from "./diff";
import type { Snapshot } from "./snapshot";

/** One row of the report timeline (PLAN Phase 4 deliverable 7): one archived copy of one page. */
export interface TimelineEntry {
  year: number;
  snapshot_url: string;
  claims_present: string[];
  /** Claims present in the previous snapshot of the same page and absent from this one. */
  claims_removed: string[];
  /** The brand page this snapshot belongs to. */
  page_url: string;
  /** YYYY-MM-DD of the capture. */
  snapshot_date: string;
  /** Year of the previous snapshot of the same page, when there is one. */
  previous_year?: number;
}

/**
 * A removal waiting for the Phase 7 diff classifier. Until then it stays
 * `unclassified` and its signal ships (rule-based). Phase 7 may set
 * `redesign`/`moved` (the signal is dropped) but never add a removal.
 */
export interface DiffCandidate {
  signalId: string;
  pageUrl: string;
  sentence: string;
  ruleIds: RuleId[];
  from: { timestamp: string; snapshotUrl: string; before: string[]; after: string[] };
  to: { timestamp: string; snapshotUrl: string; nearest: string | null; nearestSimilarity: number; context: string[] };
  classification: "unclassified";
}

export interface RetractionResult {
  signals: Signal[];
  candidates: DiffCandidate[];
  timeline: TimelineEntry[];
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

interface ClaimSentence {
  index: number;
  sentence: string;
  ruleIds: RuleId[];
}

/** Sentences of a snapshot that match a claim rule (same rules and context as the live-page engine). */
function claimSentences(sentences: string[], brand?: string): ClaimSentence[] {
  const out: ClaimSentence[] = [];
  sentences.forEach((sentence, index) => {
    const ruleIds = classify(sentence, sentences[index + 1], brand).map((m) => m.ruleId);
    if (ruleIds.length > 0) out.push({ index, sentence, ruleIds });
  });
  return out;
}

const uniqueExcerpts = (list: string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const k = normaliseSentence(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(excerptOf(s, 0));
  }
  return out;
};

/**
 * Compares each pair of consecutive snapshots of one page (oldest first).
 * For every sentence removed between them that a claim rule matches and that
 * has no near-equivalent in the later snapshot, emits one `claim.removed`
 * signal whose receipt is the earlier snapshot (source_url = its `id_` URL,
 * snapshot_date = its capture date, fetched_at = when we fetched it). The same
 * claim removed again after reappearing gives one signal (the first removal).
 */
export function detectRetractions(snapshots: Snapshot[], opts: { brand?: string; config?: WaybackConfig } = {}): RetractionResult {
  const config = opts.config ?? WAYBACK_CONFIG;
  const sorted = [...snapshots].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const split = sorted.map((s) => splitSentences(s.text));
  const claims = split.map((sentences) => claimSentences(sentences, opts.brand));
  const signals: Signal[] = [];
  const candidates: DiffCandidate[] = [];
  const timeline: TimelineEntry[] = [];
  const reported = new Set<string>();

  sorted.forEach((snap, i) => {
    const entry: TimelineEntry = {
      year: snap.year,
      snapshot_url: snap.snapshotUrl,
      claims_present: uniqueExcerpts(claims[i].map((c) => c.sentence)),
      claims_removed: [],
      page_url: snap.pageUrl,
      snapshot_date: snap.date,
    };
    timeline.push(entry);
    if (i === 0) return;

    const prev = sorted[i - 1];
    entry.previous_year = prev.year;
    const diff = diffSentences(split[i - 1], split[i], prev.timestamp, snap.timestamp);
    const removedKeys = new Set(diff.removed.map(normaliseSentence));
    const removedClaims: string[] = [];

    for (const claim of claims[i - 1]) {
      const key = normaliseSentence(claim.sentence);
      if (!removedKeys.has(key)) continue;
      // Reworded or moved: something close enough is still on the later page.
      let nearest: string | null = null;
      let best = 0;
      let bestIndex = -1;
      split[i].forEach((s, j) => {
        const sim = similarity(claim.sentence, s);
        if (sim > best) {
          best = sim;
          nearest = s;
          bestIndex = j;
        }
      });
      if (best >= config.sameClaimSimilarity) continue;

      removedClaims.push(claim.sentence);
      if (reported.has(key)) continue;
      reported.add(key);

      const id = `wayback-removed-${hash(`${snap.pageUrl} ${key}`)}`;
      const n = config.contextSentences;
      signals.push({
        id,
        axis: "track",
        kind: "claim.removed",
        label: signalLabels.claimRemoved(prev.year, snap.year),
        weight_hint: DEFAULT_WEIGHT_HINT,
        source_url: prev.snapshotUrl,
        fetched_at: prev.fetchedAt,
        excerpt: excerptOf(claim.sentence, 0),
        snapshot_date: prev.date,
        llm_used: false,
      });
      candidates.push({
        signalId: id,
        pageUrl: snap.pageUrl,
        sentence: claim.sentence,
        ruleIds: claim.ruleIds,
        from: {
          timestamp: prev.timestamp,
          snapshotUrl: prev.snapshotUrl,
          before: split[i - 1].slice(Math.max(0, claim.index - n), claim.index),
          after: split[i - 1].slice(claim.index + 1, claim.index + 1 + n),
        },
        to: {
          timestamp: snap.timestamp,
          snapshotUrl: snap.snapshotUrl,
          nearest,
          nearestSimilarity: best,
          context: bestIndex >= 0 ? split[i].slice(Math.max(0, bestIndex - n), bestIndex + 1 + n) : [],
        },
        classification: "unclassified",
      });
    }
    entry.claims_removed = uniqueExcerpts(removedClaims);
  });

  return { signals, candidates, timeline };
}
