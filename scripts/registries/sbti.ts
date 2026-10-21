// Records registry sources as offline fixtures (v1.1). Phase 11: the SBTi Target
// Dashboard companies export.
//
// Usage: npm run record:registries -- sbti (dispatcher: scripts/record-registries.ts)
// Behind a TLS-intercepting proxy, set NODE_EXTRA_CA_CERTS to the proxy CA bundle.
//
// The full export (~2.3 MB, ~15.8k rows) is downloaded once (robots.txt checked
// first, descriptive User-Agent, normal TLS verification, 1 request per second per
// host) and saved TRIMMED (ADR-026, ADR-031): the rows whose company_name matches a
// fixture brand, a ground-truth brand (fixtures/validation/ground-truth.json, if
// present) or one of the test-case names below (ADR-019 rule: equal or whole-word),
// plus 50 rows picked with a fixed-seed random generator. Rows are copied verbatim
// (every column). The full file's last-modified, row count and sha256 are written to
// fixtures/sources/sbti/README.md; the full file is not committed.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { EnvHttpProxyAgent, interceptors, request } from "undici";
import { RateLimitedFetcher, UndiciFetcher, USER_AGENT } from "../../src/lib/fetch/fetcher";
import { RateLimiter } from "../../src/lib/fetch/rate-limiter";
import { RobotsChecker } from "../../src/lib/fetch/robots";
import { SBTI_CONFIG, parseSbtiExport } from "../../src/lib/registries/sbti";
import { matchEntity } from "../../src/lib/regulators/match";


/** Names whose real rows the tests need (beyond fixture and ground-truth brands). */
const TEST_CASE_NAMES = [
  "Amazon", // Commitment Removed, Expired commitment; ISIN on Wikidata (identifier match)
  "Unilever", // near-term validated, net-zero Commitment Removed
  "Austrian Post", // Commitment Removed, "Target set at parent company level" (status note)
  "Activision Blizzard", // Commitment Removed, "Company change" (status note)
  "Aviva", // Commitment Removed, "Withdrawn commitment"
  "Coca-Cola", // only longer names ⇒ possible matches
  "Nestlé", // equal row plus a longer "Nestlé Nespresso" row
  "ALDI Nord Group", // Commitment to Set Targets
  "Danone",
  "IKEA",
  "Inditex",
  "H&M Group",
  "ASOS",
  "Arla Foods",
  "Patagonia",
];
const RANDOM_ROWS = 50;
const SEED = 20261021;

const ROOT = join("fixtures", "sources", "sbti");

function fixtureBrandNames(): string[] {
  const dir = join("fixtures", "brands");
  const out: string[] = ["Shell", "TotalEnergies"]; // regulator-only fixture cases (fixtures/sources/README.md)
  for (const slug of readdirSync(dir)) {
    const meta = join(dir, slug, "meta.json");
    if (!existsSync(meta)) continue;
    const m = JSON.parse(readFileSync(meta, "utf8")) as { capture?: string; entity?: { name?: string } };
    if (m.capture === "real" && m.entity?.name) out.push(m.entity.name);
  }
  return out;
}

function groundTruthNames(): string[] {
  const file = join("fixtures", "validation", "ground-truth.json");
  if (!existsSync(file)) return [];
  const gt = JSON.parse(readFileSync(file, "utf8")) as { entries?: { name?: string }[] };
  return (gt.entries ?? []).map((e) => e.name ?? "").filter(Boolean);
}

/** mulberry32: a small deterministic generator, so the random rows are reproducible from the seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function recordSbti(): Promise<void> {
  const capturedAt = new Date().toISOString();
  const date = capturedAt.slice(0, 10);
  const url = SBTI_CONFIG.exportUrl;
  const limiter = new RateLimiter(1000);
  const robots = new RobotsChecker(new RateLimitedFetcher(new UndiciFetcher(), limiter));
  const verdict = await robots.check(url);
  if (!verdict.allowed) {
    console.error(`robots.txt: ${verdict.reason}`);
    process.exit(1);
  }
  await limiter.wait(url);
  const res = await request(url, {
    method: "GET",
    dispatcher: new EnvHttpProxyAgent().compose(interceptors.redirect({ maxRedirections: 5 })),
    headers: { "user-agent": USER_AGENT, accept: "*/*" },
    headersTimeout: 60_000,
    bodyTimeout: 120_000,
  });
  if (res.statusCode !== 200) {
    console.error(`HTTP ${res.statusCode} for ${url}`);
    process.exit(1);
  }
  const full = Buffer.from(await res.body.arrayBuffer());
  const header = (n: string) => {
    const v = res.headers[n];
    return Array.isArray(v) ? v[0] : (v ?? "");
  };
  const lastModified = header("last-modified");
  const sha256 = createHash("sha256").update(full).digest("hex");
  const fullRows = await parseSbtiExport(full);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(full as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  const headerValues = (ws.getRow(1).values as unknown[]).slice(1);
  const nameCol = headerValues.indexOf("company_name") + 1;

  const names = [...new Set([...fixtureBrandNames(), ...groundTruthNames(), ...TEST_CASE_NAMES])];
  const keep = new Set<number>();
  const dataRows: number[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    dataRows.push(n);
    const company = String(row.getCell(nameCol).value ?? "");
    if (names.some((b) => matchEntity(b, { title: company }) !== "none")) keep.add(n);
  });
  const named = keep.size;
  const rand = rng(SEED);
  const pool = dataRows.filter((n) => !keep.has(n));
  for (let i = 0; i < RANDOM_ROWS && pool.length; i++) keep.add(pool.splice(Math.floor(rand() * pool.length), 1)[0]);

  const out = new ExcelJS.Workbook();
  const sheet = out.addWorksheet(ws.name);
  sheet.addRow(headerValues);
  for (const n of [...keep].sort((a, b) => a - b)) sheet.addRow((ws.getRow(n).values as unknown[]).slice(1, headerValues.length + 1));
  const trimmed = Buffer.from(await out.xlsx.writeBuffer());
  const trimmedRows = (await parseSbtiExport(trimmed)).length;

  await mkdir(ROOT, { recursive: true });
  const file = `companies-${date}.xlsx`;
  await writeFile(join(ROOT, file), trimmed);
  await writeFile(
    join(ROOT, "manifest.json"),
    JSON.stringify({ $comment: "Real capture by scripts/record-registries.ts (fixtures/sources/sbti/README.md). URL ⇒ file and its capture time.", files: { [url]: { file, capturedAt } } }, null, 2) + "\n",
  );
  const readme = `# SBTi Target Dashboard export (Phase 11)

Real capture of the SBTi companies export, recorded by \`npm run record:registries -- sbti\`
(\`scripts/record-registries.ts\`): robots.txt of the export host checked first (it answers 404: no restrictions),
\`GreenwashRadar/0.1 …\` User-Agent, normal TLS verification through the container's proxy CA, 1 request per second per host.
Served offline for \`${url}\` by \`src/lib/fetch/source-fixtures.ts\` through \`manifest.json\` (capture time = \`fetched_at\`).

The full file is not committed (ADR-026, ADR-031). \`${file}\` is the export **trimmed** to the rows whose \`company_name\`
equals or contains as a whole word (ADR-019 rule) one of the names below, plus ${RANDOM_ROWS} rows chosen by a fixed-seed generator
(seed ${SEED}). Every kept row is copied verbatim, all columns, in the export's order.

Terms: SBTi's website terms allow storing the data for non-commercial research use with credit. Source: Science Based
Targets initiative, Target Dashboard export (${date}), https://sciencebasedtargets.org/target-dashboard

## Full export as fetched

| Field | Value |
|---|---|
| URL | ${url} |
| Captured | ${capturedAt} |
| last-modified | ${lastModified} |
| Size (bytes) | ${full.length} |
| sha256 | ${sha256} |
| Data rows | ${fullRows.length} |

## Trimmed fixture

| Field | Value |
|---|---|
| File | ${file} |
| Rows matching a name | ${named} |
| Random rows | ${keep.size - named} |
| Trimmed data rows | ${trimmedRows} |

Names (fixture brands, regulator-only cases, ground-truth brands present at capture time, test cases):
${names.map((n) => `\`${n}\``).join(", ")}.
`;
  await writeFile(join(ROOT, "README.md"), readme);
  console.log(`full: ${fullRows.length} rows, sha256 ${sha256}, last-modified ${lastModified}`);
  console.log(`trimmed: ${trimmedRows} rows (${named} named + ${keep.size - named} random) ⇒ ${join(ROOT, file)}`);
}
