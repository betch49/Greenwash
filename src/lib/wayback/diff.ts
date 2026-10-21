// Sentence-level diff between two snapshots (PLAN Phase 4 deliverable 3).

import { diffArrays } from "diff";
import { splitSentences } from "../claims/split";

export interface SnapshotDiff {
  /** Sentences of the earlier snapshot that are not in the later one (original wording). */
  removed: string[];
  /** Sentences of the later snapshot that are not in the earlier one. */
  added: string[];
  /** Wayback timestamps of the two snapshots. */
  from: string;
  to: string;
}

/** Comparison key: case, whitespace, quotes and trailing punctuation do not make a sentence different. */
export const normaliseSentence = (s: string) =>
  s
    .toLowerCase()
    .replace(/[“”«»„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[\s.!?…:;,]+$/u, "")
    .trim();

/**
 * `diffArrays` over the two sentence lists, with sentences compared by their
 * normalised form. A sentence that only moved shows up in both `removed` and
 * `added`; the retraction detector handles that with its similarity check.
 */
export function diffSentences(fromSentences: string[], toSentences: string[], from: string, to: string): SnapshotDiff {
  const changes = diffArrays(fromSentences, toSentences, { comparator: (a, b) => normaliseSentence(a) === normaliseSentence(b) });
  const removed: string[] = [];
  const added: string[] = [];
  for (const c of changes) {
    if (c.removed) removed.push(...c.value);
    else if (c.added) added.push(...c.value);
  }
  return { removed, added, from, to };
}

/** Diff of two snapshot texts (visible text, one block per line). */
export function diffSnapshots(a: { text: string; timestamp: string }, b: { text: string; timestamp: string }): SnapshotDiff {
  return diffSentences(splitSentences(a.text), splitSentences(b.text), a.timestamp, b.timestamp);
}

const bigrams = (s: string): Map<string, number> => {
  const out = new Map<string, number>();
  const t = s.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
};

/**
 * Normalised string similarity in [0, 1]: Sørensen–Dice coefficient over the
 * character bigrams of the normalised sentences. 1 = same text.
 */
export function similarity(a: string, b: string): number {
  const na = normaliseSentence(a);
  const nb = normaliseSentence(b);
  if (na === nb) return 1;
  const A = bigrams(na);
  const B = bigrams(nb);
  let sizeA = 0;
  let sizeB = 0;
  for (const n of A.values()) sizeA += n;
  for (const n of B.values()) sizeB += n;
  if (sizeA + sizeB === 0) return 0;
  let common = 0;
  for (const [g, n] of A) common += Math.min(n, B.get(g) ?? 0);
  return (2 * common) / (sizeA + sizeB);
}
