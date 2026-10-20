import { createHash } from "node:crypto";
import { claimFamilyNames, signalLabels } from "../copy/wording";
import { countWords, type PageLink } from "../discover/visible-text";
import type { Signal } from "../pipeline/signal";
import { EXCERPT_MAX_CHARS } from "./lexicon";
import { CLAIM_RULES, RULE_IDS, type RuleId, type RuleMatch } from "./rules";
import { splitSentences } from "./split";
import { findSubstantiation, type Marker } from "./substantiation";

/** The page record a scan reads its receipt from. */
export interface PageMeta {
  url: string;
  fetchedAt: string;
  links?: PageLink[];
  /** The run's brand name (a commitment subject for the future_only rule, ADR-015). */
  brand?: string;
}

export interface RuleStats {
  /** Matched sentences, counting every occurrence on the page. */
  matches: number;
  /** Matched sentences with no substantiation marker in the window. */
  unsupported: number;
  per1000: number;
  unsupportedPer1000: number;
}

/** Per-1,000-word claim counts per rule family (brief Section 4, claims axis input). */
export interface ClaimStats {
  wordCount: number;
  sentenceCount: number;
  byRule: Record<RuleId, RuleStats>;
  matches: number;
  unsupported: number;
  per1000: number;
  unsupportedPer1000: number;
}

/** One rule hit, with the substantiation found for it (kept for the report and for Phase 7). */
export interface ClaimHit {
  ruleId: RuleId;
  sentence: string;
  phrase: string;
  supported: boolean;
  markers: Marker[];
  signalId: string;
}

export interface ScanResult {
  signals: Signal[];
  stats: ClaimStats;
  hits: ClaimHit[];
}

/**
 * Neutral placeholder: every Phase 3 signal carries weight_hint 1. Points per
 * kind come from config/weights.json in the scorer (Phase 6); no rule decides
 * a score here.
 */
export const DEFAULT_WEIGHT_HINT = 1;

const PER = 1000;
const rate = (n: number, words: number) => (words > 0 ? (n * PER) / words : 0);

function emptyByRule(): Record<RuleId, RuleStats> {
  return Object.fromEntries(RULE_IDS.map((id) => [id, { matches: 0, unsupported: 0, per1000: 0, unsupportedPer1000: 0 }])) as Record<
    RuleId,
    RuleStats
  >;
}

function finish(stats: Omit<ClaimStats, "per1000" | "unsupportedPer1000">): ClaimStats {
  for (const r of Object.values(stats.byRule)) {
    r.per1000 = rate(r.matches, stats.wordCount);
    r.unsupportedPer1000 = rate(r.unsupported, stats.wordCount);
  }
  return { ...stats, per1000: rate(stats.matches, stats.wordCount), unsupportedPer1000: rate(stats.unsupported, stats.wordCount) };
}

/** Sums the counts of several pages and recomputes the rates over their total word count. */
export function mergeStats(list: ClaimStats[]): ClaimStats {
  const byRule = emptyByRule();
  let wordCount = 0;
  let sentenceCount = 0;
  let matches = 0;
  let unsupported = 0;
  for (const s of list) {
    wordCount += s.wordCount;
    sentenceCount += s.sentenceCount;
    matches += s.matches;
    unsupported += s.unsupported;
    for (const id of RULE_IDS) {
      byRule[id].matches += s.byRule[id].matches;
      byRule[id].unsupported += s.byRule[id].unsupported;
    }
  }
  return finish({ wordCount, sentenceCount, byRule, matches, unsupported });
}

/** Cuts a sentence to the excerpt limit, keeping the matched phrase in view. */
export function excerptOf(sentence: string, focus: number): string {
  if (sentence.length <= EXCERPT_MAX_CHARS) return sentence;
  const room = EXCERPT_MAX_CHARS - 2;
  const start = Math.max(0, Math.min(focus - Math.floor(room / 4), sentence.length - room));
  const body = sentence.slice(start, start + room).trim();
  return `${start > 0 ? "…" : ""}${body}${start + room < sentence.length ? "…" : ""}`.slice(0, EXCERPT_MAX_CHARS);
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** A question asserts nothing ("How sustainable is a phone?"), so it is never a claim. */
export const isQuestion = (sentence: string) => /\?["”’»)\]]*$/u.test(sentence.trim());

/** Runs every rule on one sentence (with the next sentence as context). Questions never match. */
export function classify(sentence: string, next?: string, brand?: string): RuleMatch[] {
  const out: RuleMatch[] = [];
  if (isQuestion(sentence)) return out;
  for (const rule of CLAIM_RULES) {
    const m = rule.test(sentence, { next, brand });
    if (m) out.push(m);
  }
  return out;
}

/**
 * Scans one page's visible text with the claim rules. Every rule hit becomes a
 * receipted signal: excerpt = the matched sentence (≤ 300 chars), source_url
 * and fetched_at = the page record, llm_used = false. A hit with no
 * substantiation marker in its window is kind `claim.unsupported`, otherwise
 * `claim.supported`. Repeated sentences count in the stats every time they
 * occur but give one signal per rule.
 */
export function scanPage(pageText: string, meta: PageMeta): ScanResult {
  const sentences = splitSentences(pageText);
  const byRule = emptyByRule();
  const signals: Signal[] = [];
  const hits: ClaimHit[] = [];
  const seen = new Set<string>();
  let matches = 0;
  let unsupported = 0;

  sentences.forEach((sentence, i) => {
    for (const m of classify(sentence, sentences[i + 1], meta.brand)) {
      const sub = findSubstantiation(sentences, i, m.spans, meta.links ?? [], { ruleId: m.ruleId, brand: meta.brand });
      matches++;
      byRule[m.ruleId].matches++;
      if (!sub.supported) {
        unsupported++;
        byRule[m.ruleId].unsupported++;
      }
      const key = `${m.ruleId} ${normalise(sentence)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const id = `claim-${m.ruleId}-${hash(`${meta.url} ${normalise(sentence)}`)}`;
      const family = claimFamilyNames[m.ruleId];
      signals.push({
        id,
        axis: "claims",
        kind: sub.supported ? "claim.supported" : "claim.unsupported",
        label: sub.supported ? signalLabels.claimSupported(family) : signalLabels.claimUnsupported(family),
        weight_hint: DEFAULT_WEIGHT_HINT,
        source_url: meta.url,
        fetched_at: meta.fetchedAt,
        excerpt: excerptOf(sentence, m.spans[0][0]),
        llm_used: false,
      });
      hits.push({ ruleId: m.ruleId, sentence, phrase: m.phrase, supported: sub.supported, markers: sub.markers, signalId: id });
    }
  });

  const stats = finish({ wordCount: countWords(pageText), sentenceCount: sentences.length, byRule, matches, unsupported });
  return { signals, stats, hits };
}
