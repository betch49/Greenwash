// Repair rules on the brand's own fetched pages (Phase 5, axis E). Each rule
// reads the page's visible text lines and every link text (navigation links
// included: a footer "Spare parts" link to the brand's parts shop is the brand
// offering parts). Deterministic; docs/METHODOLOGY.md Section 9 lists every rule.
import { createHash } from "node:crypto";
import { excerpts, signalLabels } from "../copy/wording";
import { excerptOf } from "../claims/engine";
import type { EvidencePage } from "../claims/evidence-rules";
import type { Signal } from "../pipeline/signal";

export const REPAIR_RULE_IDS = ["repair_manual", "spare_parts", "warranty_years", "repair_program"] as const;
export type RepairRuleId = (typeof REPAIR_RULE_IDS)[number];

/** Placeholder hint until Phase 6 (per-kind points in config/weights.json decide what a repair signal is worth). */
const REPAIR_WEIGHT_HINT = 1;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, "twenty-five": 25, thirty: 30,
};
const NUM = `(\\d{1,2}|twenty-five|${Object.keys(NUMBER_WORDS).filter((w) => w !== "twenty-five").join("|")})`;
const KIND = `(?:warranty|guarantee)`;
const ADJ = `(?:(?:limited|extended|standard|full|manufacturer(?:['’]s)?|product|quality|repair)[- ])*`;

export const RULES = {
  repair_manual: /\b(?:repair guides?|service manuals?|repair manuals?|repair tutorials?)\b/iu,
  spare_parts: /\b(?:spare parts?|replacement parts?|parts store|parts shop)\b/iu,
  repair_program: /\b(?:repair programm?e?s?|repair services?|we repair|send it in for repair|send (?:it|your (?:device|product)) (?:in )?(?:for repair|to (?:our|a) (?:repair|service) cent(?:er|re)s?))\b/iu,
  warranty: [
    // "2-year warranty", "5 year limited warranty", "five-year warranty", "2-year quality guarantee"
    new RegExp(`\\b${NUM}[- ]years?[- ]${ADJ}${KIND}\\b`, "giu"),
    // "warranty of 3 years", "guarantee period of up to 10 years"
    new RegExp(`\\b${KIND}(?: period)? of (?:up to )?${NUM}[- ]years?\\b`, "giu"),
  ],
  lifetime: /\blifetime (?:limited )?(?:warranty|guarantee)\b/iu,
} as const;

const toYears = (s: string): number | null => {
  const w = s.toLowerCase();
  const n = /^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w];
  return n && n > 0 && n <= 99 ? n : null;
};

/** The longest warranty a text states: "lifetime" beats any number of years; null when none. */
export function parseWarrantyYears(text: string): number | "lifetime" | null {
  if (RULES.lifetime.test(text)) return "lifetime";
  let best: number | null = null;
  for (const re of RULES.warranty) {
    for (const m of text.matchAll(re)) {
      const y = toYears(m[1]);
      if (y !== null && (best === null || y > best)) best = y;
    }
  }
  return best;
}

export interface RepairFinding {
  rule: RepairRuleId;
  url: string;
  fetchedAt: string;
  excerpt: string;
  warrantyYears?: number | "lifetime";
}

export interface RepairPagesResult {
  findings: RepairFinding[];
  signals: Signal[];
  /** URLs of the pages that were read. */
  scanned: string[];
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const yearsRank = (y: number | "lifetime") => (y === "lifetime" ? Number.POSITIVE_INFINITY : y);

/** Text units of a page in reading order: each visible line, then each link text (with its target). */
function units(page: EvidencePage): { text: string; excerpt: (at: number) => string }[] {
  const lines = page.text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => ({ text: l, excerpt: (at: number) => excerptOf(l, at) }));
  const links = page.links
    .filter((l) => l.text.trim())
    .map((l) => ({ text: l.text.trim(), excerpt: () => excerpts.link(l.text.trim(), l.href) }));
  return [...lines, ...links];
}

function firstHit(page: EvidencePage, re: RegExp): { excerpt: string } | null {
  for (const u of units(page)) {
    const m = re.exec(u.text);
    if (m) return { excerpt: u.excerpt(m.index) };
  }
  return null;
}

function bestWarranty(page: EvidencePage): { years: number | "lifetime"; excerpt: string } | null {
  let best: { years: number | "lifetime"; excerpt: string } | null = null;
  for (const u of units(page)) {
    const y = parseWarrantyYears(u.text);
    if (y === null) continue;
    if (!best || yearsRank(y) > yearsRank(best.years)) {
      const at = u.text.search(/warrant|guarant/i);
      best = { years: y, excerpt: u.excerpt(Math.max(0, at)) };
    }
  }
  return best;
}

function signal(kind: string, label: string, url: string, fetchedAt: string, excerpt: string): Signal {
  return {
    id: `repair-${kind.replace(/^repair\./, "")}-${hash(`${url} ${excerpt}`)}`,
    axis: "repair",
    kind,
    label,
    weight_hint: REPAIR_WEIGHT_HINT,
    source_url: url,
    fetched_at: fetchedAt,
    excerpt,
    llm_used: false,
  };
}

/**
 * Runs the four repair rules over the fetched pages. One finding (and one protective
 * signal) per rule: the first page, in fetch order, where the rule matches; for the
 * warranty, the longest warranty stated on any page. No rule matching on any page ⇒
 * one `repair.no_repair_info_found` risk signal whose receipt is the first page and
 * whose excerpt lists every page scanned (title and URL).
 */
export function evaluateRepairPages(pages: EvidencePage[]): RepairPagesResult {
  const findings: RepairFinding[] = [];
  for (const rule of ["repair_manual", "spare_parts", "repair_program"] as const) {
    for (const p of pages) {
      const hit = firstHit(p, RULES[rule]);
      if (hit) {
        findings.push({ rule, url: p.url, fetchedAt: p.fetchedAt, excerpt: hit.excerpt });
        break;
      }
    }
  }
  let warranty: RepairFinding | null = null;
  for (const p of pages) {
    const w = bestWarranty(p);
    if (w && (!warranty || yearsRank(w.years) > yearsRank(warranty.warrantyYears!))) {
      warranty = { rule: "warranty_years", url: p.url, fetchedAt: p.fetchedAt, excerpt: w.excerpt, warrantyYears: w.years };
    }
  }
  if (warranty) findings.push(warranty);

  const signals: Signal[] = findings.map((f) => {
    switch (f.rule) {
      case "repair_manual":
        return signal("repair.manual_found", signalLabels.repairManual, f.url, f.fetchedAt, f.excerpt);
      case "spare_parts":
        return signal("repair.spare_parts_found", signalLabels.spareParts, f.url, f.fetchedAt, f.excerpt);
      case "repair_program":
        return signal("repair.program_found", signalLabels.repairProgram, f.url, f.fetchedAt, f.excerpt);
      case "warranty_years":
        return signal("repair.warranty_found", signalLabels.warranty(f.warrantyYears!), f.url, f.fetchedAt, f.excerpt);
    }
  });
  if (findings.length === 0 && pages.length > 0) {
    const first = pages[0];
    signals.push(
      signal("repair.no_repair_info_found", signalLabels.noRepairInfo, first.url, first.fetchedAt, excerpts.pagesScannedWithUrls(pages.map((p) => ({ title: p.title, url: p.url })))),
    );
  }
  return { findings, signals, scanned: pages.map((p) => p.url) };
}
