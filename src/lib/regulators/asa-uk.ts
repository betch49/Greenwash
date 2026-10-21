// UK Advertising Standards Authority (ASA) adapter. Search page:
// https://www.asa.org.uk/search.html?q=<brand> (server-rendered); ruling pages
// under /rulings/. Every fetch goes through the robots-guarded page fetcher.
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

const NAME = "ASA";

/** ASA outcome words ⇒ outcome. "Upheld in part" is upheld, with a note. */
export function asaOutcome(text: string): { outcome: RulingOutcome; note?: string } {
  const t = collapse(text).toLowerCase();
  if (/^not upheld/.test(t)) return { outcome: "not_upheld" };
  if (/^upheld in part|^partly upheld|^partially upheld/.test(t)) return { outcome: "upheld", note: "upheld in part" };
  if (/^upheld/.test(t)) return { outcome: "upheld" };
  if (/informally resolved|resolved informally/.test(t)) return { outcome: "informally_resolved" };
  return { outcome: "unknown" };
}

const isRulingUrl = (href: string) => {
  try {
    const u = new URL(href);
    return u.hostname === "www.asa.org.uk" && u.pathname.startsWith(config.asa.rulingPathPrefix) && u.pathname.endsWith(".html");
  } catch {
    return false;
  }
};

/** Parses the search results page into ruling hits (news, guidance and other pages are ignored). */
export function parseAsaSearch(html: string, baseUrl: string): RulingCandidate[] {
  const $ = cheerio.load(html);
  const listing = $("#sitewide-search-listing");
  const noResults = /No results were found to match your search/i.test($(".main-content").text() || $("body").text());
  if (listing.length === 0 && !noResults) throw new RegulatorParseError(reasons.regulatorParse(NAME, "search page"));
  const out: RulingCandidate[] = [];
  const seen = new Set<string>();
  listing.find("li.result-item").each((_, li) => {
    const a = $(li).find("h4.heading a[href]").first();
    const href = a.attr("href");
    if (!href) return;
    const url = new URL(href, baseUrl).toString();
    if (!isRulingUrl(url) || seen.has(url)) return;
    seen.add(url);
    const captions = $(li)
      .find(".meta-listing .caption")
      .map((__, c) => collapse($(c).text()))
      .get();
    const date = captions.map(parseDayMonthYear).find(Boolean) ?? undefined;
    const outcomeText = captions.find((c) => asaOutcome(c).outcome !== "unknown");
    out.push({ url, title: collapse(a.text()), ...(date ? { date } : {}), ...(outcomeText ? { outcomeText } : {}) });
  });
  return out;
}

/** Parses a ruling page: advertiser from the "ASA Ruling on …" heading, outcome and date from the meta line under it. */
export function parseAsaRuling(html: string, url: string, fetchedAt: string): Ruling {
  const $ = cheerio.load(html);
  const h1 = collapse($(".title-section h1").first().text() || $("h1").first().text());
  const m = /^ASA Ruling on\s+(.+)$/i.exec(h1);
  if (!m) throw new RegulatorParseError(reasons.regulatorParse(NAME, `ruling page ${url}`));
  const advertiser = m[1].trim();
  const captions = $(".title-section .meta-listing .caption")
    .map((_, c) => collapse($(c).text()))
    .get();
  const outcomeText = captions.find((c) => asaOutcome(c).outcome !== "unknown") ?? captions[0] ?? "";
  const date = captions.map(parseDayMonthYear).find(Boolean);
  // The ruling text: every heading and paragraph of the main content, from "Background" on.
  const main = $(".main-content").first();
  const parts = main
    .find("h2, p")
    .map((_, el) => collapse($(el).text()))
    .get()
    .filter(Boolean);
  const start = parts.findIndex((p) => /^Background$/i.test(p));
  const summary = (start >= 0 ? parts.slice(start + 1) : parts).join(" ");
  if (!date || !summary) throw new RegulatorParseError(reasons.regulatorParse(NAME, `ruling page ${url}`));
  const { outcome, note } = asaOutcome(outcomeText);
  return {
    url,
    title: h1,
    advertiser,
    date,
    outcome,
    outcomeText,
    ...(note ? { note } : {}),
    excerpt: firstChars(summary, RULING_EXCERPT_CHARS),
    text: summary,
    fetchedAt,
  };
}

export const asaUk: RegulatorAdapter = {
  id: "asa-uk",
  name: NAME,
  country: "United Kingdom",
  searchUrl: (brand) => config.asa.searchUrl.replace("{q}", encodeURIComponent(searchQuery(brand))),
  async search(brand, fetcher: Fetcher) {
    const url = this.searchUrl(brand);
    const res = await getRegulatorPage(fetcher, url, NAME);
    return parseAsaSearch(res.body, url);
  },
  async fetchRuling(url, fetcher: Fetcher) {
    const res = await getRegulatorPage(fetcher, url, NAME);
    return parseAsaRuling(res.body, url, res.fetchedAt);
  },
};
