// Records the Sabin Center climate litigation pages (PLAN Phase 13 deliverable 6) as
// offline fixtures under fixtures/sources/sabin/, with their own manifest.json:
// - the geography pages of the fixture brands' countries, France, the United Kingdom
//   and the United States (only the families they server-render);
// - the seed-index document pages (SEED below), and fixtures/sources/sabin/index.json.
// Only /document/<slug> and /geographies/<slug> are requested (plus robots.txt, which is
// checked before every request); 1 request per second; descriptive User-Agent; normal TLS
// verification through the container's proxy CA (NODE_EXTRA_CA_CERTS).
//
// Usage: npm run record:registries -- sabin   (alias: npm run record:sabin); the dispatcher
// scripts/record-registries.ts imports this file, which records on import.
//
// What is changed at capture time (fixtures/sources/sabin/README.md): inline <script> bodies
// are removed, except the server-rendered `__NEXT_DATA__` JSON the parser reads, from which
// `envConfig` (the app's API token and keys), `themeConfig` and `familyTopics` (concept
// counts) are dropped. Every other byte is as served.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { RateLimitedFetcher, UndiciFetcher, type FetchOptions, type FetchResult, type Fetcher } from "../src/lib/fetch/fetcher";
import { RateLimiter } from "../src/lib/fetch/rate-limiter";
import { guardedPageFetcher } from "../src/lib/pipeline/run";
import { geographyUrl, isAllowedSabinUrl, parseGeographyPage, sabin, type SeedEntry } from "../src/lib/registries/sabin";

const ROOT = join("fixtures", "sources", "sabin");
const capturedAt = new Date().toISOString();
const DROP = ["envConfig", "themeConfig", "familyTopics"];

/**
 * Seed index: document pages the builder reached on the site on 2026-10-21. Each URL was
 * found by following the site's own permanent redirect from the case's legacy URL
 * (`/non-us-case/<slug>/` ⇒ 301 ⇒ `/document/<slug>_<id>`) or on a geography listing.
 */
const SEED: { url: string; recorded_from: string }[] = [
  {
    url: "https://www.climatecasechart.com/document/greenpeace-france-and-others-v-totalenergies-se-and-totalenergies-electricite-et-gaz-france_3e1f",
    recorded_from: "301 redirect of https://www.climatecasechart.com/non-us-case/greenpeace-france-and-others-v-totalenergies-se-and-totalenergies-electricite-et-gaz-france/",
  },
  { url: "https://www.climatecasechart.com/document/clientearth-v-blackrock_51f1", recorded_from: "https://www.climatecasechart.com/geographies/france (listing of 2026-10-21)" },
  {
    url: "https://www.climatecasechart.com/document/milieudefensie-et-al-v-royal-dutch-shell-plc_c3e4",
    recorded_from: "301 redirect of https://www.climatecasechart.com/non-us-case/milieudefensie-et-al-v-royal-dutch-shell-plc/",
  },
  {
    url: "https://www.climatecasechart.com/document/clientearth-v-shells-board-of-directors_9377",
    recorded_from: "301 redirect of https://www.climatecasechart.com/non-us-case/clientearth-v-shells-board-of-directors/",
  },
];
const GEOGRAPHIES = ["switzerland", "netherlands", "sweden", "france", "united-kingdom", "united-states-of-america"];

const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function clean(html: string, url: string): string {
  const body = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (all, attrs: string, inner: string) => {
    if (/id="__NEXT_DATA__"/i.test(attrs)) {
      const data = JSON.parse(inner) as { props: { pageProps: Record<string, unknown> } };
      for (const k of DROP) delete data.props.pageProps[k];
      return `<script${attrs}>${JSON.stringify(data)}</script>`;
    }
    if (/\bsrc\s*=/i.test(attrs) || inner.trim() === "") return all;
    return `<script${attrs}></script>`;
  });
  return `<!-- real capture: ${url} on ${capturedAt.slice(0, 10)} by scripts/record-sabin.ts; inline script bodies removed; __NEXT_DATA__ kept without ${DROP.join(", ")} -->\n${body}`;
}

class RecordingFetcher implements Fetcher {
  readonly files: Record<string, { file: string; capturedAt: string }> = {};
  readonly log: string[] = [];
  private readonly inner = new RateLimitedFetcher(new UndiciFetcher(), new RateLimiter(1000));

  async get(url: string, opts?: FetchOptions): Promise<FetchResult> {
    if (!isAllowedSabinUrl(url)) throw new Error(`recorder refuses ${url}`);
    const res = await this.inner.get(url, opts);
    this.log.push(`${res.status} ${url}`);
    if (res.status < 200 || res.status >= 300 || this.files[url]) return res;
    const u = new URL(url);
    const rel = u.pathname === "/robots.txt" ? `robots-${slugOf(u.host)}.txt` : `${slugOf(u.pathname.split("/")[1])}-${slugOf(u.pathname.split("/").slice(2).join("-"))}.html`;
    const body = rel.endsWith(".html") ? clean(res.body, url) : res.body;
    const file = join(ROOT, rel);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
    this.files[url] = { file: rel, capturedAt: res.fetchedAt };
    return res;
  }
}

for (const f of ["manifest.json", "index.json"]) await rm(join(ROOT, f), { force: true });
const rec = new RecordingFetcher();
const { pageFetcher } = guardedPageFetcher(rec);
const report: string[] = [];

for (const slug of GEOGRAPHIES) {
  const url = geographyUrl(slug);
  const res = await pageFetcher.get(url);
  report.push(`${slug}: ${res.status === 200 ? parseGeographyPage(res.body, url).map((f) => f.title).join(" | ") : `HTTP ${res.status}`}`);
}
const entries: SeedEntry[] = [];
for (const s of SEED) {
  const c = await sabin.fetchCase(s.url, pageFetcher);
  entries.push({ url: s.url, recorded_at: capturedAt, recorded_from: s.recorded_from });
  report.push(`seed: ${c.title} [${c.status}; ${c.last_event}; filed ${c.filed_year}] parties: ${c.parties_from_title.join(" | ")}`);
}

await writeFile(
  join(ROOT, "manifest.json"),
  JSON.stringify({ $comment: "Real captures by scripts/record-sabin.ts (fixtures/sources/sabin/README.md). URL ⇒ file (relative to this directory) and its capture time.", files: rec.files }, null, 2) + "\n",
);
await writeFile(
  join(ROOT, "index.json"),
  JSON.stringify(
    {
      $comment: "Seed index of case document URLs (ADR-028). Discovery only: every entry is re-fetched and re-matched on the title of its page; nothing here is a label.",
      entries,
    },
    null,
    2,
  ) + "\n",
);
console.log(rec.log.join("\n"));
console.log(report.join("\n"));
