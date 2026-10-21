import { join } from "node:path";
import { getDb, type Db } from "./db/client";
import { FetchCacheRepo } from "./db/fetch-cache-repo";
import { RunsRepo } from "./db/runs-repo";
import { CachedFetcher, RateLimitedFetcher, UndiciFetcher, type Fetcher } from "./fetch/fetcher";
import { loadBrandFixtures } from "./fetch/brand-fixtures";
import { loadSourceFixtures } from "./fetch/source-fixtures";
import { FixtureFetcher, combineMaps } from "./fetch/fixture-fetcher";
import { RateLimiter } from "./fetch/rate-limiter";
import { wikidataFixturePath } from "./wikidata/fixtures";
import { WAYBACK_HOST, waybackIntervalMs } from "./wayback/cdx";
import { waybackAwareTtl } from "./wayback/snapshot";
import type { LLMClient } from "./llm/client";
import { selectLLM } from "./llm/select";

export interface Services {
  offline: boolean;
  db: Db;
  runs: RunsRepo;
  /** General-purpose fetcher: cached + rate-limited (network) or fixtures (offline). */
  fetcher: Fetcher;
  /** MockLLM offline or without a key (then marked unavailable), AnthropicLLM with a key (Phase 7, 7.7). */
  llm: LLMClient;
}

export const isOffline = () => process.env.GR_OFFLINE_FIXTURES === "1";

/**
 * The pipeline clock. GR_FIXED_NOW (an ISO date-time) pins it, but only in
 * offline fixture mode (GR_OFFLINE_FIXTURES=1), so the fixture histories stay
 * inside the Wayback year window whatever the real date is. A live run always
 * uses the real clock; an unparsable value is ignored.
 */
export function pipelineClock(env: Record<string, string | undefined> = process.env): () => Date {
  const fixed = env.GR_OFFLINE_FIXTURES === "1" && env.GR_FIXED_NOW ? Date.parse(env.GR_FIXED_NOW) : NaN;
  return Number.isNaN(fixed) ? () => new Date() : () => new Date(fixed);
}

const HOUR_MS = 3_600_000;

export function buildFetcher(db: Db, offline: boolean): Fetcher {
  if (offline) {
    const root = process.env.GR_FIXTURES_DIR || join(process.cwd(), "fixtures");
    const brands = loadBrandFixtures(root);
    const sources = loadSourceFixtures(root);
    return new FixtureFetcher(
      root,
      combineMaps(wikidataFixturePath, brands.map, sources.map),
      (url) => brands.capturedAt(url) ?? sources.capturedAt(url) ?? new Date().toISOString(),
    );
  }
  const ttlMs = Number(process.env.GR_CACHE_TTL_HOURS || 168) * HOUR_MS;
  // Archived snapshots never change: cached forever. CDX listings and live pages: the default TTL.
  return new CachedFetcher(new RateLimitedFetcher(new UndiciFetcher(), buildRateLimiter()), new FetchCacheRepo(db), waybackAwareTtl(ttlMs));
}

/**
 * Per-host limiter for network fetches: GR_RATE_LIMIT_MS (default 1000) per host,
 * and web.archive.org never faster than one request per second whatever
 * WAYBACK_RATE_LIMIT_MS says (brief Section 1).
 */
export function buildRateLimiter(
  env: Record<string, string | undefined> = process.env,
  opts: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): RateLimiter {
  const perHostMs = Number(env.GR_RATE_LIMIT_MS || 1000);
  return new RateLimiter(perHostMs, { ...opts, hostMinimums: { [WAYBACK_HOST]: waybackIntervalMs(env) } });
}

const g = globalThis as unknown as { __grServices?: Services };

export function getServices(): Services {
  if (!g.__grServices) {
    const db = getDb();
    const offline = isOffline();
    g.__grServices = { offline, db, runs: new RunsRepo(db), fetcher: buildFetcher(db, offline), llm: selectLLM() };
  }
  return g.__grServices;
}
