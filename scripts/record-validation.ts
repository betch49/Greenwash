// Records the validation ground truth (PLAN Phase 10 deliverable 1, docs/SOURCES.md
// "how an entry is made"): fetches every cited page and every negative check, stores
// the copies under fixtures/validation/citations/, writes each citation's one-line
// "why" from what the fetched page says, and writes fixtures/validation/ground-truth.json.
//
// Usage: npm run record:validation
// Input: fixtures/validation/candidates.json (hand-written: brand, website, the URLs to cite).
// Behind a TLS-intercepting proxy, set NODE_EXTRA_CA_CERTS to the proxy CA bundle.
//
// Etiquette: robots.txt checked before every request (RobotsChecker, fail closed), one
// request per second per host, the app's User-Agent, normal TLS verification.
// Honesty rules: a citation whose page cannot be fetched, or whose content does not say
// what the role needs (e.g. an SBTi row that is not "Commitment Removed" for a flag), is
// dropped and reported; the group is computed from the verified citations only; a
// candidate that ends up with neither a flag nor two markers is left out and reported.
// Inline <script> bodies are removed from stored HTML except JSON data blocks.
import * as cheerio from "cheerio";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request, EnvHttpProxyAgent, interceptors } from "undici";
import { RateLimitedFetcher, UndiciFetcher, USER_AGENT, type FetchResult } from "../src/lib/fetch/fetcher";
import { RateLimiter } from "../src/lib/fetch/rate-limiter";
import { guardedPageFetcher } from "../src/lib/pipeline/run";
import { parseAsaRuling, parseAsaSearch } from "../src/lib/regulators/asa-uk";
import { parseJdpDecision, parseJdpSearch } from "../src/lib/regulators/jdp-fr";
import { matchEntity } from "../src/lib/regulators/match";
import { asaUk } from "../src/lib/regulators/asa-uk";
import { jdpFr } from "../src/lib/regulators/jdp-fr";
// This script deliberately does not import src/lib/validation (criterion 10.4: that module is
// imported only by scripts/validate.ts and tests). tests/unit/validation/ground-truth.test.ts
// checks the file it writes against the schema and the SOURCES.md rules.
type CitationSource = "changing_markets" | "asa" | "jdp" | "sabin" | "sbti" | "newclimate" | "fti" | "netzerotracker" | "bcorp";
interface Citation {
  source: CitationSource;
  role: "flag" | "positive";
  url: string;
  date: string;
  why: string;
  verified_from_container: boolean;
  file?: string;
}
interface Check {
  source: CitationSource;
  url: string;
  date: string;
  result: string;
  file?: string;
}
interface Entry {
  slug: string;
  name: string;
  query?: string;
  wikidata_id?: string;
  website: string;
  group: "flagged" | "well_rated" | "contested";
  citations: Citation[];
  checks: Check[];
  fixture?: string;
}
const positiveMarkers = (e: Pick<Entry, "citations">) => new Set(e.citations.filter((c) => c.role === "positive").map((c) => c.source)).size;

const ROOT = join("fixtures", "validation");
const CIT = join(ROOT, "citations");
const SBTI_EXPORT = "https://files.sciencebasedtargets.org/production/files/companies-excel.xlsx";
const GREENWASH_INDEX = "https://greenwash.com/wash-by-brand/";
const NOT_A_FLAG_REASONS = [/target set at parent company level/i, /company change/i];

interface CandidateCitation {
  source: CitationSource;
  role: "flag" | "positive";
  url: string;
  /** SBTi: the exact `company_name` of the export row. */
  match?: string;
  /** ASA/JDP: the environmental topic, written after reading the stored ruling. */
  topic?: string;
}
interface Candidate {
  slug: string;
  name: string;
  query?: string;
  wikidata_id?: string;
  website: string;
  fixture?: string;
  citations: CandidateCitation[];
}

const today = new Date().toISOString();
const day = today.slice(0, 10);
const inner = new RateLimitedFetcher(new UndiciFetcher({ maxTries: 4, backoffMs: 3000 }), new RateLimiter(1000));
const { pageFetcher, robots } = guardedPageFetcher(inner);
const log: string[] = [];
const dropped: string[] = [];

function stripInlineScripts(html: string): string {
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (all, attrs: string, body: string) => {
    if (/\bsrc\s*=/i.test(attrs) || /application\/(ld\+)?json/i.test(attrs) || body.trim() === "") return all;
    return `<script${attrs}></script>`;
  });
}

function save(rel: string, body: string) {
  mkdirSync(CIT, { recursive: true });
  writeFileSync(join(ROOT, rel), body);
}

const saveHtml = (rel: string, url: string, res: FetchResult) =>
  save(rel, `<!-- real capture: ${url} on ${res.fetchedAt.slice(0, 10)} by scripts/record-validation.ts; inline script bodies removed -->\n${stripInlineScripts(res.body)}`);

const pageCache = new Map<string, FetchResult>();
async function get(url: string): Promise<FetchResult> {
  const hit = pageCache.get(url);
  if (hit) return hit;
  const res = await pageFetcher.get(url);
  log.push(`${res.status} ${url}`);
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} for ${url}`);
  pageCache.set(url, res);
  return res;
}

// ---- SBTi export (binary .xlsx, read with the system `unzip`; Phase 11 brings exceljs for the app) ----
type Row = Record<string, string>;
let sbti: { rows: Row[]; lastModified: string; fetchedAt: string; sha256: string } | null = null;
async function sbtiRows() {
  if (sbti) return sbti;
  const verdict = await robots.check(SBTI_EXPORT);
  if (!verdict.allowed) throw new Error(verdict.reason);
  const dispatcher = new EnvHttpProxyAgent().compose(interceptors.redirect({ maxRedirections: 3 }));
  const res = await request(SBTI_EXPORT, { dispatcher, headers: { "user-agent": USER_AGENT } });
  if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode} for ${SBTI_EXPORT}`);
  const buf = Buffer.from(await res.body.arrayBuffer());
  log.push(`200 ${SBTI_EXPORT} (${buf.length} bytes)`);
  const dir = mkdtempSync(join(tmpdir(), "gr-sbti-"));
  try {
    const file = join(dir, "companies.xlsx");
    writeFileSync(file, buf);
    const read = (entry: string) => execFileSync("unzip", ["-p", file, entry], { maxBuffer: 256 * 1024 * 1024 }).toString("utf8");
    const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
    const shared = [...read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
    const colIndex = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const table: string[][] = [];
    for (const r of read("xl/worksheets/sheet1.xml").matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of r[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] ?? "")?.[1];
        const isShared = /t="s"/.test(c[2]);
        cells[colIndex(c[1])] = v === undefined ? "" : isShared ? shared[Number(v)] : decode(v);
      }
      table.push(Array.from(cells, (x) => x ?? ""));
    }
    const header = table[0];
    const rows = table.slice(1).map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]).filter(([h]) => h)));
    sbti = { rows, lastModified: String(res.headers["last-modified"] ?? ""), fetchedAt: new Date().toISOString(), sha256: createHash("sha256").update(buf).digest("hex") };
    return sbti;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const excelDate = (serial: string) => (/^\d+(\.\d+)?$/.test(serial) ? new Date(Date.UTC(1899, 11, 30) + Number(serial) * 86_400_000).toISOString().slice(0, 10) : serial);

// ---- one citation ----
async function record(c: Candidate, cit: CandidateCitation, n: number): Promise<Citation | null> {
  const base = `${c.slug}-${n}`;
  if (cit.source === "sbti") {
    const data = await sbtiRows();
    const rows = data.rows.filter((r) => r.company_name === cit.match);
    if (rows.length !== 1) throw new Error(`SBTi: ${rows.length} rows named "${cit.match}"`);
    const r = rows[0];
    const removed = [r.near_term_status, r.net_zero_status].some((s) => s === "Commitment Removed");
    const notAFlag = NOT_A_FLAG_REASONS.some((re) => re.test(r.status_reason ?? ""));
    if (cit.role === "flag" && (!removed || notAFlag)) throw new Error(`SBTi row "${cit.match}" is not a removed commitment that counts as a flag`);
    if (cit.role === "positive" && !(r.near_term_status === "Validated Targets" && r.net_zero_status === "Validated Targets")) throw new Error(`SBTi row "${cit.match}" does not have validated near-term and net-zero targets`);
    const keep = ["sbti_id", "company_name", "isin", "lei", "location", "sector", "near_term_status", "near_term_target_year", "net_zero_status", "net_zero_year", "status_reason", "date_updated"];
    const row = Object.fromEntries(keep.map((k) => [k, k === "date_updated" ? excelDate(r[k] ?? "") : (r[k] ?? "")]));
    const rel = `citations/${base}.json`;
    save(rel, `${JSON.stringify({ $comment: "Real capture: one row of the SBTi companies export, trimmed to these columns by scripts/record-validation.ts. Source: Science Based Targets initiative, Target Dashboard export, https://sciencebasedtargets.org/target-dashboard", url: SBTI_EXPORT, last_modified: data.lastModified, fetched_at: data.fetchedAt, export_sha256: data.sha256, export_rows: data.rows.length, row }, null, 2)}\n`);
    const why = `SBTi export row "${r.company_name}": near-term "${r.near_term_status}", net-zero "${r.net_zero_status || "none"}"${r.status_reason ? `, status reason "${r.status_reason}"` : ""}${row.date_updated ? `, updated ${row.date_updated}` : ""}`;
    return { source: "sbti", role: cit.role, url: SBTI_EXPORT, date: data.fetchedAt.slice(0, 10), why, verified_from_container: true, file: rel };
  }
  const res = await get(cit.url);
  const rel = `citations/${base}.html`;
  let why: string;
  const $ = cheerio.load(res.body);
  if (cit.source === "changing_markets") {
    const heads = $("h2")
      .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
      .get()
      // Page chrome, not case articles: the loading banner, the newsletter and privacy blocks.
      .filter((h) => h && !/email signup|privacy|^loading|sign-up to receive/i.test(h));
    if (!heads.length) throw new Error(`greenwash.com page has no case article headings: ${cit.url}`);
    const shown = heads.slice(0, 3).map((h) => `"${h}"`).join("; ");
    why = `Changing Markets' greenwash.com brand page for ${c.name} lists ${heads.length} case article(s) on its green claims: ${shown}${heads.length > 3 ? "; …" : ""}`;
  } else if (cit.source === "netzerotracker") {
    const json = $("script#__NEXT_DATA__").text();
    const co = (JSON.parse(json) as { props: { pageProps: { company?: Record<string, string | null> } } }).props.pageProps.company;
    if (!co) throw new Error(`no company record on ${cit.url}`);
    const ok = co.interim_target && co.interim_target !== "No target" && co.has_plan === "Yes";
    if (cit.role === "positive" && !ok) throw new Error(`Net Zero Tracker: no interim target and published plan for ${co.name} (${co.interim_target}, plan ${co.has_plan})`);
    why = `Net Zero Tracker: ${co.end_target} by ${co.end_target_year} (${co.end_target_status}); interim target: ${co.interim_target}${co.interim_target_year ? ` ${co.interim_target_year}` : ""}; published plan: ${co.has_plan} (record updated ${String(co.last_updated).slice(0, 10)})`;
  } else if (cit.source === "asa" || cit.source === "jdp") {
    const ruling = cit.source === "asa" ? parseAsaRuling(res.body, cit.url, res.fetchedAt) : parseJdpDecision(res.body, cit.url, res.fetchedAt);
    if (ruling.outcome !== "upheld") throw new Error(`${cit.source}: ruling is not upheld (${ruling.outcomeText}): ${cit.url}`);
    if (!cit.topic) throw new Error(`${cit.source}: a ruling citation needs the environmental topic: ${cit.url}`);
    why = `${ruling.title} (${ruling.date}, ${ruling.outcomeText}): ${cit.topic}`;
  } else {
    throw new Error(`no recorder for source ${cit.source}`);
  }
  saveHtml(rel, cit.url, res);
  return { source: cit.source, role: cit.role, url: cit.url, date: res.fetchedAt.slice(0, 10), why, verified_from_container: true, file: rel };
}

// ---- negative checks for well-rated candidates ----
let gwIndex: string[] | null = null;
async function greenwashIndex(): Promise<string[]> {
  if (gwIndex) return gwIndex;
  const res = await get(GREENWASH_INDEX);
  saveHtml("citations/index-greenwash-wash-by-brand.html", GREENWASH_INDEX, res);
  const $ = cheerio.load(res.body);
  gwIndex = [...new Set($('a[href*="/brands/"]').map((_, a) => $(a).attr("href")!).get())];
  return gwIndex;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function checks(c: Candidate): Promise<{ checks: Check[]; problems: string[] }> {
  const out: Check[] = [];
  const problems: string[] = [];
  const idx = await greenwashIndex();
  const hit = idx.filter((u) => u.replace(/\/+$/, "").endsWith(`/brands/${norm(c.name)}`));
  out.push({ source: "changing_markets", url: GREENWASH_INDEX, date: day, result: hit.length ? `listed: ${hit.join(", ")}` : `not among the ${idx.length} brand pages of the index`, file: "citations/index-greenwash-wash-by-brand.html" });
  if (hit.length) problems.push(`greenwash.com lists ${c.name}`);
  for (const [src, adapter, parse] of [
    ["asa", asaUk, parseAsaSearch],
    ["jdp", jdpFr, parseJdpSearch],
  ] as const) {
    const url = adapter.searchUrl(c.name);
    const res = await get(url);
    const rel = `citations/${c.slug}-check-${src}.html`;
    saveHtml(rel, url, res);
    const hits = parse(res.body, url);
    const exact = hits.filter((h) => matchEntity(c.name, { title: h.title }) === "scored");
    const possible = hits.filter((h) => matchEntity(c.name, { title: h.title }) === "possible");
    // Some JDP decisions are listed as "Avis du JDP n°…" with no advertiser: they cannot be ruled out.
    const unnamed = hits.filter((h) => /^Avis du JDP n°/i.test(h.title));
    const result = exact.length
      ? `${exact.length} ruling(s) naming ${c.name}: ${exact.map((h) => `${h.title} (${h.date ?? "undated"}, ${h.outcomeText ?? "outcome not listed"})`).join("; ")}`
      : `no ruling naming ${c.name} (${hits.length} search result(s)${possible.length ? `, ${possible.length} naming a different entity that contains the name: ${possible.map((h) => h.title).join("; ")}` : ""}${unnamed.length ? `, ${unnamed.length} without an advertiser name` : ""})`;
    out.push({ source: src, url, date: res.fetchedAt.slice(0, 10), result, file: rel });
    // Conservative: any ruling naming the brand rules out a well-rated label, whatever its topic.
    if (exact.length) problems.push(`${src.toUpperCase()} has ${exact.length} ruling(s) naming ${c.name}`);
    if (unnamed.length) problems.push(`${src.toUpperCase()} lists ${unnamed.length} decision(s) without an advertiser name for this search; they cannot be ruled out`);
  }
  return { checks: out, problems };
}

async function main() {
  const candidates = (JSON.parse(readFileSync(join(ROOT, "candidates.json"), "utf8")) as { candidates: Candidate[] }).candidates;
  rmSync(CIT, { recursive: true, force: true });
  const entries: Entry[] = [];
  for (const c of candidates) {
    const citations: Citation[] = [];
    let n = 1;
    for (const cit of c.citations) {
      try {
        const rec = await record(c, cit, n);
        if (rec) {
          citations.push(rec);
          n++;
        }
      } catch (err) {
        dropped.push(`${c.slug}: citation dropped (${cit.source} ${cit.url}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const nFlags = citations.filter((x) => x.role === "flag").length;
    const probe: Entry = { slug: c.slug, name: c.name, website: c.website, group: "flagged", citations, checks: [] };
    const nMarkers = positiveMarkers(probe);
    let group: Entry["group"] | null = null;
    let entryChecks: Check[] = [];
    if (nFlags > 0) group = nMarkers >= 2 ? "contested" : "flagged";
    else if (nMarkers >= 2) {
      const r = await checks(c);
      entryChecks = r.checks;
      if (r.problems.length) dropped.push(`${c.slug}: not well-rated (${r.problems.join("; ")})`);
      else group = "well_rated";
    }
    if (!group) {
      if (!dropped.some((d) => d.startsWith(`${c.slug}: not well-rated`))) dropped.push(`${c.slug}: left out (${nFlags} flag(s), ${nMarkers} marker(s))`);
      continue;
    }
    entries.push({
      slug: c.slug,
      name: c.name,
      ...(c.query ? { query: c.query } : {}),
      ...(c.wikidata_id ? { wikidata_id: c.wikidata_id } : {}),
      website: c.website,
      group,
      citations,
      checks: entryChecks,
      ...(c.fixture ? { fixture: c.fixture } : {}),
    });
    console.log(`${c.slug}: ${group} (${nFlags} flag(s), ${nMarkers} marker(s))`);
  }
  const gt = {
    version: 1,
    label_use: "evaluation_only",
    $comment: `Evaluation-only labels (ADR-025). Recorded by scripts/record-validation.ts on ${day} from fixtures/validation/candidates.json; every citation was fetched and stored under fixtures/validation/citations/. Never read by the pipeline or the scorer.`,
    entries,
  };
  writeFileSync(join(ROOT, "ground-truth.json"), `${JSON.stringify(gt, null, 2)}\n`);
  writeFileSync(join(ROOT, "record-log.txt"), `# scripts/record-validation.ts, ${today}\n# requests\n${log.join("\n")}\n# dropped or left out\n${dropped.join("\n") || "(none)"}\n`);
  console.log(`flagged ${entries.filter((e) => e.group === "flagged").length}, well_rated ${entries.filter((e) => e.group === "well_rated").length}, contested ${entries.filter((e) => e.group === "contested").length}`);
  console.log(dropped.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
