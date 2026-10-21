// Records the regulator and repair sources (Phase 5) as offline fixtures under
// fixtures/sources/, by running the real adapters (robots-guarded, 1 request per
// second per host, descriptive User-Agent, normal TLS verification) against the
// live sites and saving every 2xx response they requested.
//
// Usage: npm run record:sources
// Behind a TLS-intercepting proxy, set NODE_EXTRA_CA_CERTS to the proxy CA bundle.
//
// Cases: the three fixture brands (ASA search, JDP search, iFixit for the brands
// whose repair axis applies), plus two regulator-only cases, real searches whose
// results the tests need: ASA "Shell" (exact and partial-name rulings, the
// `possible` path) and JDP "TotalEnergies" (decision pages for the JDP parser).
// Inline <script> bodies are removed from HTML, as for brand captures.
//
// Adding brands (Phase 10, validation fixture subset): `npm run record:sources -- --add <slug> …`
// records only those brand fixtures' cases into the existing manifest. Nothing is deleted, and a
// URL that is already recorded is served from its file (never re-fetched), so earlier captures
// stay byte-identical.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { RateLimitedFetcher, UndiciFetcher, type FetchOptions, type FetchResult, type Fetcher } from "../src/lib/fetch/fetcher";
import { RateLimiter } from "../src/lib/fetch/rate-limiter";
import { guardedPageFetcher } from "../src/lib/pipeline/run";
import { RegulatorUnavailableError } from "../src/lib/regulators/adapter";
import { asaUk } from "../src/lib/regulators/asa-uk";
import { checkRegulator } from "../src/lib/regulators/check";
import { jdpFr } from "../src/lib/regulators/jdp-fr";
import { repairApplicability } from "../src/lib/repair/applicability";
import { lookupIfixit } from "../src/lib/repair/ifixit";

const ROOT = join("fixtures", "sources");
const now = new Date();
const capturedAt = now.toISOString();

const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function stripInlineScripts(html: string): string {
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (all, attrs: string, body: string) => {
    if (/\bsrc\s*=/i.test(attrs) || /application\/ld\+json/i.test(attrs) || body.trim() === "") return all;
    return `<script${attrs}></script>`;
  });
}

const addIdx = process.argv.indexOf("--add");
const addSlugs = addIdx >= 0 ? process.argv.slice(addIdx + 1).filter((a) => !a.startsWith("--")) : [];
const adding = addIdx >= 0;
if (adding && addSlugs.length === 0) {
  console.error("usage: record-sources [--add <brand slug> …]");
  process.exit(2);
}
const existing: Record<string, { file: string; capturedAt: string }> =
  adding && existsSync(join(ROOT, "manifest.json")) ? (JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")) as { files: Record<string, { file: string; capturedAt: string }> }).files : {};

class RecordingFetcher implements Fetcher {
  readonly files: Record<string, { file: string; capturedAt: string }> = { ...existing };
  readonly log: string[] = [];
  /** Directory and file-name prefix for the case being recorded. */
  caseDir = "";
  private readonly inner = new RateLimitedFetcher(new UndiciFetcher(), new RateLimiter(1000));

  async get(url: string, opts?: FetchOptions): Promise<FetchResult> {
    const kept = existing[url];
    if (kept) {
      this.log.push(`kept ${url}`);
      const body = readFileSync(join(ROOT, kept.file), "utf8");
      return { url, status: 200, body, contentType: /\.json$/.test(kept.file) ? "application/json" : /\.txt$/.test(kept.file) ? "text/plain" : "text/html", fetchedAt: kept.capturedAt, source: "fixture" };
    }
    const res = await this.inner.get(url, opts);
    this.log.push(`${res.status} ${url}`);
    if (res.status < 200 || res.status >= 300 || this.files[url]) return res;
    const u = new URL(url);
    const host = slugOf(u.host);
    let rel: string;
    let body = res.body;
    if (u.pathname === "/robots.txt") rel = `robots/${host}.txt`;
    else if (u.host === "www.asa.org.uk" && u.pathname === "/search.html") rel = `${this.caseDir}/asa.html`;
    else if (u.host === "www.asa.org.uk") rel = `${this.caseDir}/asa-ruling-${slugOf(u.pathname.replace(/^\/rulings\/|\.html$/g, ""))}.html`;
    else if (u.host === "www.jdp-pub.org" && u.searchParams.has("search_avis")) rel = `${this.caseDir}/jdp.html`;
    else if (u.host === "www.jdp-pub.org") rel = `${this.caseDir}/jdp-avis-${slugOf(u.pathname.replace(/^\/avis\//, ""))}.html`;
    else if (u.host === "www.ifixit.com") rel = `${this.caseDir}/ifixit-${slugOf(decodeURIComponent(u.pathname.split("/").pop() ?? ""))}.json`;
    else throw new Error(`unexpected URL ${url}`);
    if (/html/i.test(res.contentType)) {
      body = `<!-- real capture: ${url} on ${capturedAt.slice(0, 10)} by scripts/record-sources.ts; inline script bodies removed -->\n${stripInlineScripts(body)}`;
    }
    const file = join(ROOT, rel);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
    this.files[url] = { file: rel, capturedAt: res.fetchedAt };
    return res;
  }
}

interface Meta { slug: string; entity: { name: string; industry?: string } }
const brands = (adding ? addSlugs : ["mammut", "fairphone", "oatly"]).map((s) => JSON.parse(readFileSync(join("fixtures", "brands", s, "meta.json"), "utf8")) as Meta);

if (!adding) await rm(ROOT, { recursive: true, force: true });
const rec = new RecordingFetcher();
const { pageFetcher } = guardedPageFetcher(rec);
const report: string[] = [];

async function regulator(adapter: typeof asaUk, brand: string, caseDir: string) {
  rec.caseDir = caseDir;
  try {
    const r = await checkRegulator(adapter, brand, pageFetcher, now);
    report.push(`${adapter.name} ${brand}: ${r.signals.length} scored, ${r.possible.length} possible ${r.possible.map((p) => p.entity_name).join(" | ")}`);
  } catch (err) {
    if (!(err instanceof RegulatorUnavailableError)) throw err;
    report.push(`${adapter.name} ${brand}: skipped: ${err.message}`);
  }
}

for (const b of brands) {
  const caseDir = `regulators/${b.slug}`;
  await regulator(asaUk, b.entity.name, caseDir);
  await regulator(jdpFr, b.entity.name, caseDir);
  if (repairApplicability(b.entity).applicable) {
    rec.caseDir = `repair/${b.slug}`;
    const r = await lookupIfixit(b.entity.name, pageFetcher);
    report.push(`iFixit ${b.entity.name}: ${r.signals.map((s) => s.kind).join(", ") || "none"} ${r.could_not_check.join(" ")}`);
  }
}
if (!adding) {
  await regulator(asaUk, "Shell", "regulators/shell");
  await regulator(jdpFr, "TotalEnergies", "regulators/totalenergies");
}

await writeFile(
  join(ROOT, "manifest.json"),
  JSON.stringify({ $comment: "Real captures by scripts/record-sources.ts (fixtures/sources/README.md). URL ⇒ file and its capture time.", files: rec.files }, null, 2) + "\n",
);
console.log(rec.log.join("\n"));
console.log(report.join("\n"));
