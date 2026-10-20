import { createHash } from "node:crypto";
import { couldNotCheck, excerpts, signalLabels } from "../copy/wording";
import type { PageLink } from "../discover/visible-text";
import type { Signal } from "../pipeline/signal";
import { DEFAULT_WEIGHT_HINT, excerptOf } from "./engine";
import { CERTIFIERS, EVIDENCE, SUBSTANTIATION } from "./lexicon";
import { phraseRegex, spansOf } from "./rules/common";
import { splitSentences } from "./split";

/** A fetched page as the evidence rules read it. */
export interface EvidencePage {
  url: string;
  title: string;
  text: string;
  links: PageLink[];
  fetchedAt: string;
}

/** Evidence rule ids (deterministic, evidence axis). docs/METHODOLOGY.md lists every id (test 3.7). */
export const EVIDENCE_RULE_IDS = ["labels_claimed", "impact_report_link", "absolute_emissions_present", "supplier_list_present"] as const;
export type EvidenceRuleId = (typeof EVIDENCE_RULE_IDS)[number];

/** A certification label named on a page. Listed under "could not check"; never a signal, never scored. */
export interface LabelClaim {
  name: string;
  url: string;
  fetchedAt: string;
  excerpt: string;
}

export interface ReportLink {
  href: string;
  text: string;
  /** Report year, when the link text or file name gives one. */
  year: number | null;
  pageUrl: string;
  fetchedAt: string;
}

export interface EvidenceResult {
  /** Scored evidence signals (labels are never among them). */
  signals: Signal[];
  labels_claimed: LabelClaim[];
  reportLinks: ReportLink[];
  could_not_check: string[];
}

const REPORT = new RegExp(EVIDENCE.reportLink, "iu");
const PDF = /\.pdf(?:$|[?#])/iu;
const YEAR_RE = new RegExp(`(?<!\\d)${SUBSTANTIATION.year}(?!\\d)`, "gu");
const EMISSIONS = phraseRegex([EVIDENCE.absoluteEmissions]);
const NOT_EMISSIONS = phraseRegex([EVIDENCE.notAbsoluteEmissions]);
const SUPPLIER = new RegExp(EVIDENCE.supplierList, "iu");
const LABELS = CERTIFIERS.filter((c) => c.label).map((c) => ({ name: c.name, re: phraseRegex([c.pattern], c.caseSensitive) }));

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const fetchYear = (iso: string) => Number(iso.slice(0, 4));

function yearsIn(s: string, maxYear: number): number[] {
  return [...s.matchAll(YEAR_RE)].map((m) => Number(m[0])).filter((y) => y <= maxYear);
}

/**
 * The year a report link refers to: from the link text first, then the file
 * name (last path segment), then the rest of the URL. Years after the page's
 * fetch year (targets such as "2030") are ignored.
 */
export function reportYear(text: string, href: string, maxYear: number): number | null {
  let path = href;
  try {
    path = decodeURIComponent(new URL(href).pathname);
  } catch {
    // keep the raw href
  }
  const file = path.split("/").filter(Boolean).pop() ?? "";
  for (const source of [text, file, path]) {
    const years = yearsIn(source, maxYear);
    if (years.length) return Math.max(...years);
  }
  return null;
}

/** `impact_report_link`: a link whose text or URL names a report, impact or sustainability, and is a PDF or carries a year. */
export function findReportLinks(page: EvidencePage): ReportLink[] {
  const out: ReportLink[] = [];
  const max = fetchYear(page.fetchedAt);
  const seen = new Set<string>();
  for (const l of page.links) {
    if (!REPORT.test(l.text) && !REPORT.test(l.href)) continue;
    const year = reportYear(l.text, l.href, max);
    if (!PDF.test(l.href) && year === null) continue;
    const key = `${l.href} ${l.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ href: l.href, text: l.text, year, pageUrl: page.url, fetchedAt: page.fetchedAt });
  }
  return out;
}

/** `labels_claimed`: certifier names in the page text. */
export function findLabels(page: EvidencePage): LabelClaim[] {
  const out: LabelClaim[] = [];
  const sentences = splitSentences(page.text);
  for (const label of LABELS) {
    for (const s of sentences) {
      const spans = spansOf(label.re, s);
      if (spans.length === 0) continue;
      out.push({ name: label.name, url: page.url, fetchedAt: page.fetchedAt, excerpt: excerptOf(s, spans[0][0]) });
      break;
    }
  }
  return out;
}

/** `absolute_emissions_present`: a number followed by tCO2e / tonnes CO2e / t CO2, not about avoided or per-unit emissions. */
export function findAbsoluteEmissions(page: EvidencePage): { sentence: string; at: number } | null {
  for (const s of splitSentences(page.text)) {
    const spans = spansOf(EMISSIONS, s);
    if (spans.length && spansOf(NOT_EMISSIONS, s).length === 0) return { sentence: s, at: spans[0][0] };
  }
  return null;
}

/** `supplier_list_present`: a link whose text names a supplier or factory list. */
export function findSupplierList(page: EvidencePage): PageLink | null {
  return page.links.find((l) => SUPPLIER.test(l.text)) ?? null;
}

function signal(kind: string, label: string, url: string, fetchedAt: string, excerpt: string): Signal {
  return {
    id: `evidence-${kind.replace(/^evidence\./, "")}-${hash(`${url} ${excerpt}`)}`,
    axis: "evidence",
    kind,
    label,
    weight_hint: DEFAULT_WEIGHT_HINT,
    source_url: url,
    fetched_at: fetchedAt,
    excerpt,
    llm_used: false,
  };
}

/**
 * Evidence-axis rules over all fetched pages of a run. Report: the newest
 * dated report link ⇒ `evidence.report_found`, or `evidence.stale_report` when
 * its year is more than `staleAfterYears` before the fetch year; no report link
 * at all ⇒ `evidence.no_report_found` (receipt: the pages scanned). Absolute
 * emissions ⇒ `evidence.absolute_emissions_found`; supplier list ⇒
 * `evidence.supplier_list_found`. Labels go to `labels_claimed` and "could not
 * check", never to `signals`.
 */
export function evaluateEvidence(pages: EvidencePage[]): EvidenceResult {
  const result: EvidenceResult = { signals: [], labels_claimed: [], reportLinks: [], could_not_check: [] };
  if (pages.length === 0) return result;

  // Labels: one entry per label name, first page that names it.
  const labelNames = new Set<string>();
  for (const p of pages) {
    for (const l of findLabels(p)) {
      if (labelNames.has(l.name)) continue;
      labelNames.add(l.name);
      result.labels_claimed.push(l);
      result.could_not_check.push(couldNotCheck.labelClaimed(l.name, l.url));
    }
  }

  // Reports.
  result.reportLinks = pages.flatMap(findReportLinks);
  const dated = result.reportLinks.filter((r) => r.year !== null);
  if (result.reportLinks.length === 0) {
    const first = pages[0];
    result.signals.push(
      signal("evidence.no_report_found", signalLabels.noReport, first.url, first.fetchedAt, excerpts.pagesScanned(pages.map((p) => p.title || p.url))),
    );
  } else {
    const newest = dated.length
      ? dated.reduce((a, b) => {
          // Newest year wins; on a tie a PDF beats a web page, then the first link found.
          if ((b.year ?? 0) !== (a.year ?? 0)) return (b.year ?? 0) > (a.year ?? 0) ? b : a;
          return !PDF.test(a.href) && PDF.test(b.href) ? b : a;
        })
      : result.reportLinks[0];
    const excerpt = excerpts.link(newest.text, newest.href);
    const fy = fetchYear(newest.fetchedAt);
    if (newest.year !== null && fy - newest.year > EVIDENCE.staleAfterYears) {
      result.signals.push(
        signal("evidence.stale_report", signalLabels.staleReport(newest.year, fy, EVIDENCE.staleAfterYears), newest.pageUrl, newest.fetchedAt, excerpt),
      );
    } else if (newest.year !== null) {
      result.signals.push(signal("evidence.report_found", signalLabels.reportFound(newest.year), newest.pageUrl, newest.fetchedAt, excerpt));
    } else {
      // An undated PDF report: present, but its age cannot be checked.
      result.signals.push(signal("evidence.report_found_undated", signalLabels.reportFoundUndated, newest.pageUrl, newest.fetchedAt, excerpt));
    }
  }

  // Absolute emissions: the first page that publishes a figure.
  for (const p of pages) {
    const hit = findAbsoluteEmissions(p);
    if (hit) {
      result.signals.push(signal("evidence.absolute_emissions_found", signalLabels.absoluteEmissions, p.url, p.fetchedAt, excerptOf(hit.sentence, hit.at)));
      break;
    }
  }

  // Supplier list: the first page that links one.
  for (const p of pages) {
    const link = findSupplierList(p);
    if (link) {
      result.signals.push(signal("evidence.supplier_list_found", signalLabels.supplierList, p.url, p.fetchedAt, excerpts.link(link.text, link.href)));
      break;
    }
  }

  return result;
}
