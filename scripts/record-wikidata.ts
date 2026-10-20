// Records live Wikidata responses as offline fixtures under fixtures/wikidata/.
// Usage: npm run record:wikidata -- patagonia acme fairphone oatly
// Behind a TLS-intercepting proxy, set NODE_EXTRA_CA_CERTS to the proxy CA bundle.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { UndiciFetcher, type FetchOptions, type FetchResult, type Fetcher } from "../src/lib/fetch/fetcher";
import { RateLimiter } from "../src/lib/fetch/rate-limiter";
import { wikidataFixturePath } from "../src/lib/wikidata/fixtures";
import { disambiguate } from "../src/lib/wikidata/disambiguate";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RecordingFetcher implements Fetcher {
  private readonly inner = new UndiciFetcher({ maxTries: 8, maxRetryAfterMs: 90_000, backoffMs: 5_000 });
  private readonly limiter = new RateLimiter(1_500);

  async get(url: string, opts?: FetchOptions): Promise<FetchResult> {
    const rel = wikidataFixturePath(url);
    if (!rel) throw new Error(`not a Wikidata URL: ${url}`);
    for (let attempt = 1; ; attempt++) {
      await this.limiter.wait(url);
      const res = await this.inner.get(url, opts);
      const busy = res.status === 200 && /"error"\s*:/.test(res.body.slice(0, 200));
      if (res.status === 200 && !busy) {
        const file = join("fixtures", rel);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(JSON.parse(res.body), null, 1) + "\n");
        console.log(`recorded ${file}`);
        return res;
      }
      if (attempt >= 8) throw new Error(`gave up on ${url}: HTTP ${res.status} ${res.body.slice(0, 120)}`);
      console.log(`retrying (${res.status}${busy ? ", busy" : ""}) ${url}`);
      await sleep(10_000 * attempt);
    }
  }
}

const queries = process.argv.slice(2);
const fetcher = new RecordingFetcher();
for (const q of queries) {
  const r = await disambiguate(fetcher, q);
  console.log(
    q,
    JSON.stringify({ confident: r.confident?.id ?? null, candidates: r.candidates.map((c) => `${c.id} ${c.name} ${c.websiteHost ?? "-"}`) }),
  );
}
