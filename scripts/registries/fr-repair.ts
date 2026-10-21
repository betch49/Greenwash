// Records the French repairability index sources (Phase 12) under fixtures/sources/fr-repair/,
// by running the real module (src/lib/registries/fr-repair.ts) through the robots guard,
// 1 request per second per host, the GreenwashRadar User-Agent, normal TLS verification, and
// retries with exponential backoff (data.gouv.fr resets connections from some egresses).
//
// Cases: the fixture brands whose repair axis applies (Mammut, Fairphone; Oatly is food) and two
// real publishers whose datasets carry no licence (Electrolux: organisation-name match, the gated
// case; Bosch: "Robert Bosch France SAS", the possible-match case). Gated CSVs are never fetched.
//
// API pages are stored trimmed to the fields the module reads (the full pages are ~1 MB); the
// manifest records each original body's size and sha256. CSVs and robots.txt are stored as served.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { RateLimitedFetcher, UndiciFetcher, type FetchOptions, type FetchResult, type Fetcher } from "../../src/lib/fetch/fetcher";
import { RateLimiter } from "../../src/lib/fetch/rate-limiter";
import { guardedPageFetcher } from "../../src/lib/pipeline/run";
import { checkFrRepair } from "../../src/lib/registries/fr-repair";
import { repairApplicability } from "../../src/lib/repair/applicability";

const ROOT = join("fixtures", "sources", "fr-repair");

interface Entry {
  file: string;
  capturedAt: string;
  original?: { bytes: number; sha256: string };
}

const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Keeps only the fields src/lib/registries/fr-repair.ts reads (plus a few identifying ones). */
function trimApiPage(body: string): string {
  const o = JSON.parse(body) as { data: Record<string, unknown>[]; [k: string]: unknown };
  const pick = (x: Record<string, unknown> | null | undefined, keys: string[]) => (x ? Object.fromEntries(keys.filter((k) => k in x).map((k) => [k, x[k]])) : x);
  return (
    JSON.stringify(
      {
        $comment: "Trimmed real capture of the data.gouv.fr datasets API (fields read by src/lib/registries/fr-repair.ts); original size and sha256 in manifest.json.",
        data: o.data.map((d) => ({
          ...pick(d, ["id", "slug", "title", "page", "uri", "license", "created_at", "last_modified"]),
          organization: pick(d.organization as Record<string, unknown> | null, ["id", "name", "slug", "page"]),
          owner: pick(d.owner as Record<string, unknown> | null, ["id", "first_name", "last_name"]),
          resources: ((d.resources as Record<string, unknown>[]) ?? []).map((r) => pick(r, ["id", "title", "format", "url", "created_at", "last_modified"])),
        })),
        next_page: o.next_page,
        page: o.page,
        page_size: o.page_size,
        previous_page: o.previous_page,
        total: o.total,
      },
      null,
      1,
    ) + "\n"
  );
}

class RecordingFetcher implements Fetcher {
  readonly files: Record<string, Entry> = {};
  readonly log: string[] = [];
  private readonly memo = new Map<string, FetchResult>();
  private readonly inner = new RateLimitedFetcher(new UndiciFetcher({ maxTries: 6, backoffMs: 2000 }), new RateLimiter(1000));

  async get(url: string, opts?: FetchOptions): Promise<FetchResult> {
    const hit = this.memo.get(url);
    if (hit) return hit;
    const res = await this.inner.get(url, opts);
    this.memo.set(url, res);
    this.log.push(`${res.status} ${url}`);
    if (res.status < 200 || res.status >= 300) return res;
    const u = new URL(url);
    let rel: string;
    let body = res.body;
    let original: Entry["original"];
    if (u.pathname === "/robots.txt") rel = `robots/${slugOf(u.host)}.txt`;
    else if (u.host === "www.data.gouv.fr" && u.pathname === "/api/1/datasets/") {
      rel = `api/datasets-page-${u.searchParams.get("page") ?? "1"}.json`;
      original = { bytes: Buffer.byteLength(body), sha256: sha256(body) };
      body = trimApiPage(body);
    } else if (u.host === "tabular-api.data.gouv.fr") rel = `csv/tabular-${slugOf(u.pathname.split("/")[3] ?? "x")}.csv`;
    else if (u.host === "static.data.gouv.fr") rel = `csv/static-${slugOf(u.pathname.split("/").pop() ?? "x")}`;
    else throw new Error(`unexpected URL ${url}`);
    const file = join(ROOT, rel);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
    this.files[url] = { file: rel, capturedAt: res.fetchedAt, ...(original ? { original } : {}) };
    return res;
  }
}

interface Meta {
  slug: string;
  entity: { name: string; industry?: string };
}

export async function recordFrRepair(): Promise<void> {
  const fixtureBrands = ["mammut", "fairphone", "oatly"].map((s) => JSON.parse(readFileSync(join("fixtures", "brands", s, "meta.json"), "utf8")) as Meta);
  const cases = [...fixtureBrands.filter((b) => repairApplicability(b.entity).applicable).map((b) => b.entity.name), "Electrolux", "Bosch"];
  await rm(ROOT, { recursive: true, force: true });
  const rec = new RecordingFetcher();
  const { pageFetcher } = guardedPageFetcher(rec);
  const report: string[] = [];
  for (const brand of cases) {
    const r = await checkFrRepair(brand, pageFetcher);
    report.push(`${brand}: ${r.listed} datasets listed; signals: ${r.signals.map((s) => `${s.kind} (${s.source_url})`).join(", ") || "none"}`);
    for (const l of r.could_not_check) report.push(`  could not check: ${l}`);
  }
  await writeFile(
    join(ROOT, "manifest.json"),
    JSON.stringify({ $comment: "Real captures by scripts/record-registries.ts fr-repair (fixtures/sources/fr-repair/README.md). URL ⇒ file (relative to this directory) and its capture time; trimmed API pages carry the original body's size and sha256.", cases, files: rec.files }, null, 2) + "\n",
  );
  console.log(rec.log.join("\n"));
  console.log(report.join("\n"));
}
