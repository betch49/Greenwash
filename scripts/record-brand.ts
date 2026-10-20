// Records a brand's pages as offline fixtures under fixtures/brands/<slug>/ by
// running the real discovery + fetch steps (robots-guarded, 1 req/s per host)
// against the live site and saving every 2xx response the pipeline requested.
//
// Usage: npm run record:brand -- <slug> <wikidata query> <sector>
//   e.g. npm run record:brand -- fairphone fairphone electronics
// Behind a TLS-intercepting proxy, set NODE_EXTRA_CA_CERTS to the proxy CA bundle.
//
// Changes made at capture (documented in fixtures/brands/README.md):
// - inline <script> bodies are removed from HTML (never part of the visible text);
// - sitemaps over 1 MB are rewritten to the same <loc> list without hreflang alternates.
import * as cheerio from "cheerio";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { discoverCandidates } from "../src/lib/discover/discover";
import { fetchPages } from "../src/lib/discover/fetch-pages";
import { RateLimitedFetcher, UndiciFetcher, USER_AGENT, type FetchOptions, type FetchResult, type Fetcher } from "../src/lib/fetch/fetcher";
import { FixtureFetcher } from "../src/lib/fetch/fixture-fetcher";
import { RateLimiter } from "../src/lib/fetch/rate-limiter";
import { guardedPageFetcher } from "../src/lib/pipeline/run";
import { disambiguate } from "../src/lib/wikidata/disambiguate";
import { wikidataFixturePath } from "../src/lib/wikidata/fixtures";

const [slug, query, sector] = process.argv.slice(2);
if (!slug || !query || !sector) {
  console.error("usage: record-brand <slug> <wikidata query> <sector>");
  process.exit(2);
}

const BRAND_DIR = join("fixtures", "brands", slug);
const capturedAt = new Date().toISOString();
const MAX_SITEMAP_BYTES = 1_000_000;

const pathSlug = (u: URL) =>
  (u.pathname + u.search)
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "home";

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function stripInlineScripts(html: string): string {
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (all, attrs: string, body: string) => {
    if (/\bsrc\s*=/i.test(attrs) || /application\/ld\+json/i.test(attrs) || body.trim() === "") return all;
    return `<script${attrs}></script>`;
  });
}

function reduceSitemap(xml: string): string {
  const $ = cheerio.load(xml, { xml: true });
  const isIndex = $("sitemapindex").length > 0;
  const locs = $(isIndex ? "sitemapindex > sitemap > loc" : "urlset > url > loc")
    .map((_, el) => $(el).text().trim())
    .get();
  const tag = isIndex ? "sitemap" : "url";
  const root = isIndex ? "sitemapindex" : "urlset";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<!-- reduced at capture: hreflang alternates and other child elements removed; same <loc> list (${locs.length} entries) -->\n` +
    `<${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    locs.map((l) => `<${tag}><loc>${xmlEscape(l)}</loc></${tag}>`).join("\n") +
    `\n</${root}>\n`
  );
}

class RecordingFetcher implements Fetcher {
  readonly files: Record<string, string> = {};
  readonly log: string[] = [];
  private readonly inner = new RateLimitedFetcher(new UndiciFetcher(), new RateLimiter(1000));

  async get(url: string, opts?: FetchOptions): Promise<FetchResult> {
    const res = await this.inner.get(url, opts);
    this.log.push(`${res.status} ${url}`);
    if (res.status < 200 || res.status >= 300) return res;
    const u = new URL(url);
    const host = u.host.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const type = res.contentType.toLowerCase();
    let rel: string;
    let body = res.body;
    if (u.pathname === "/robots.txt") {
      rel = `robots/${host}.txt`;
    } else if (type.includes("xml") || /\.xml$/i.test(u.pathname)) {
      rel = `sitemaps/${host}-${pathSlug(u)}.xml`;
      if (Buffer.byteLength(body) > MAX_SITEMAP_BYTES) body = reduceSitemap(body);
    } else if (type.includes("html")) {
      rel = `pages/${host}-${pathSlug(u)}.html`;
      body = `<!-- real capture: ${url} on ${capturedAt.slice(0, 10)} by scripts/record-brand.ts; inline script bodies removed -->\n${stripInlineScripts(body)}`;
    } else {
      return res;
    }
    const file = join(BRAND_DIR, rel);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
    this.files[url] = rel;
    return res;
  }
}

// The entity comes from the recorded Wikidata fixtures (Phase 1), so meta.json matches offline mode.
const wikidata = new FixtureFetcher("fixtures", wikidataFixturePath);
const { confident } = await disambiguate(wikidata, query);
if (!confident?.website) throw new Error(`no confident Wikidata match with a website for "${query}"`);
const website = confident.website;
console.log(`recording ${confident.name} (${confident.id}) from ${website}`);

await rm(BRAND_DIR, { recursive: true, force: true });
const recorder = new RecordingFetcher();
const { pageFetcher, robots } = guardedPageFetcher(recorder);
const { candidates } = await discoverCandidates(website, pageFetcher, robots);
const result = await fetchPages(candidates, pageFetcher);

await writeFile(join(BRAND_DIR, "manifest.json"), JSON.stringify({ capturedAt, files: recorder.files }, null, 2) + "\n");
await writeFile(
  join(BRAND_DIR, "meta.json"),
  JSON.stringify({ slug, query, sector, website, capture: "real", capturedAt, userAgent: USER_AGENT, entity: confident }, null, 2) + "\n",
);
console.log(recorder.log.join("\n"));
console.log(`pages: ${result.pages.map((p) => `${p.url} (${p.wordCount} words)`).join("\n       ")}`);
console.log(`skipped: ${JSON.stringify(result.skipped)}`);
console.log(`not found: ${result.notFound.length}, duplicates: ${result.duplicates.length}`);
