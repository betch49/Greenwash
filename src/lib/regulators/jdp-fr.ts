// France Jury de Déontologie Publicitaire (JDP) adapter. The decisions listing
// https://www.jdp-pub.org/avis/ takes the search box's parameter `search_avis`
// (the WordPress `?s=` parameter does not filter this listing; probe 2026-10-20).
// Decision pages live under /avis/<slug>/.
import * as cheerio from "cheerio";
import config from "../../../config/regulators.json";
import type { Fetcher } from "../fetch/fetcher";
import { reasons } from "../copy/wording";
import {
  RULING_EXCERPT_CHARS,
  RegulatorParseError,
  collapse,
  firstChars,
  getRegulatorPage,
  parseDayMonthYear,
  type RegulatorAdapter,
  type Ruling,
  type RulingCandidate,
  type RulingOutcome,
} from "./adapter";
import { searchQuery } from "./match";

const NAME = "JDP";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * JDP outcome words ⇒ outcome (PLAN Phase 5 deliverable 2): "partiellement fondée" ⇒ upheld with a note;
 * "non fondée" or "rejetée" ⇒ not upheld; "fondée" ⇒ upheld. Checked in that order, so "non fondée" is never read
 * as "fondée", and "Plainte fondée / Demande de révision rejetée" (the brand's appeal was rejected) is upheld.
 */
export function jdpOutcome(text: string): { outcome: RulingOutcome; note?: string } {
  const t = fold(collapse(text));
  if (/partiellement fondee?s?/.test(t)) return { outcome: "upheld", note: "partiellement fondée" };
  if (/non[- ]fondee?s?/.test(t)) return { outcome: "not_upheld" };
  if (/\bfondee?s?\b/.test(t)) return { outcome: "upheld" };
  if (/rejetee?s?/.test(t)) return { outcome: "not_upheld" };
  return { outcome: "unknown" };
}

const isDecisionUrl = (href: string) => {
  try {
    const u = new URL(href);
    const rest = u.pathname.slice(config.jdp.decisionPathPrefix.length);
    return u.hostname === "www.jdp-pub.org" && u.pathname.startsWith(config.jdp.decisionPathPrefix) && /^[a-z0-9-]+\/$/.test(rest) && !rest.startsWith("page/");
  } catch {
    return false;
  }
};

/** Parses the decisions listing (search results) into decision hits. */
export function parseJdpSearch(html: string, baseUrl: string): RulingCandidate[] {
  const $ = cheerio.load(html);
  const cards = $("article.jdp-avis-auto__card");
  if (cards.length === 0 && $("form.search_avis").length === 0) throw new RegulatorParseError(reasons.regulatorParse(NAME, "decisions listing"));
  const out: RulingCandidate[] = [];
  const seen = new Set<string>();
  cards.each((_, card) => {
    const href = $(card).find("a.jdp-avis-auto__card-link[href]").attr("href");
    if (!href) return;
    const url = new URL(href, baseUrl).toString();
    if (!isDecisionUrl(url) || seen.has(url)) return;
    seen.add(url);
    const title = collapse($(card).find(".jdp-avis-auto__title-line").first().text());
    const datetime = $(card).find("time[datetime]").attr("datetime");
    const date = datetime && /^\d{4}-\d{2}-\d{2}/.test(datetime) ? datetime.slice(0, 10) : undefined;
    const outcomeText = collapse($(card).find(".jdp-avis-auto__badge").text()) || undefined;
    if (!title) return;
    out.push({ url, title, ...(date ? { date } : {}), ...(outcomeText ? { outcomeText } : {}) });
  });
  return out;
}

/**
 * Parses a decision page: the advertiser is the page heading (JDP titles decisions by advertiser),
 * the outcome the heading that reads as an outcome, the date "Avis publié le <date>", and the summary
 * the text from "1. La plainte" on (or the decision text after "rend l'avis suivant").
 */
export function parseJdpDecision(html: string, url: string, fetchedAt: string): Ruling {
  const $ = cheerio.load(html);
  const h1 = collapse($("h1").first().text());
  if (!h1) throw new RegulatorParseError(reasons.regulatorParse(NAME, `decision page ${url}`));
  const scope = $("h1").first().closest("article, main, .entry-content, .container").first();
  const root = scope.length ? scope : $("body");
  const outcomeText =
    root
      .find("h2, h3")
      .map((_, el) => collapse($(el).text()))
      .get()
      .find((t) => jdpOutcome(t).outcome !== "unknown") ?? "";
  const blocks = root
    .find("p, h2, h3, h4, li")
    .map((_, el) => collapse($(el).text()))
    .get()
    .filter(Boolean);
  const dateLine = blocks.find((b) => /^Avis publi[ée] le/i.test(b)) ?? "";
  const date = parseDayMonthYear(dateLine);
  let start = blocks.findIndex((b) => /^1\.\s*La plainte/i.test(b));
  if (start >= 0) start += 1;
  else {
    const after = blocks.findIndex((b) => /rend l.avis suivant/i.test(b));
    start = after >= 0 ? after + 1 : 0;
  }
  const summary = blocks.slice(start).join(" ");
  if (!date || !summary) throw new RegulatorParseError(reasons.regulatorParse(NAME, `decision page ${url}`));
  const { outcome, note } = jdpOutcome(outcomeText);
  return {
    url,
    title: h1,
    advertiser: h1,
    date,
    outcome,
    outcomeText,
    ...(note ? { note } : {}),
    excerpt: firstChars(summary, RULING_EXCERPT_CHARS),
    text: summary,
    fetchedAt,
  };
}

export const jdpFr: RegulatorAdapter = {
  id: "jdp-fr",
  name: NAME,
  country: "France",
  searchUrl: (brand) => config.jdp.searchUrl.replace("{q}", encodeURIComponent(searchQuery(brand))),
  async search(brand, fetcher: Fetcher) {
    const url = this.searchUrl(brand);
    const res = await getRegulatorPage(fetcher, url, NAME);
    return parseJdpSearch(res.body, url);
  },
  async fetchRuling(url, fetcher: Fetcher) {
    const res = await getRegulatorPage(fetcher, url, NAME);
    return parseJdpDecision(res.body, url, res.fetchedAt);
  },
};
