import { join } from "node:path";
import { getDb, type Db } from "./db/client";
import { FetchCacheRepo } from "./db/fetch-cache-repo";
import { RunsRepo } from "./db/runs-repo";
import { CachedFetcher, RateLimitedFetcher, UndiciFetcher, type Fetcher } from "./fetch/fetcher";
import { FixtureFetcher, combineMaps } from "./fetch/fixture-fetcher";
import { RateLimiter } from "./fetch/rate-limiter";
import { wikidataFixturePath } from "./wikidata/fixtures";

export interface Services {
  offline: boolean;
  db: Db;
  runs: RunsRepo;
  /** General-purpose fetcher: cached + rate-limited (network) or fixtures (offline). */
  fetcher: Fetcher;
}

export const isOffline = () => process.env.GR_OFFLINE_FIXTURES === "1";

const HOUR_MS = 3_600_000;

export function buildFetcher(db: Db, offline: boolean): Fetcher {
  if (offline) {
    const root = process.env.GR_FIXTURES_DIR || join(process.cwd(), "fixtures");
    return new FixtureFetcher(root, combineMaps(wikidataFixturePath));
  }
  const perHostMs = Number(process.env.GR_RATE_LIMIT_MS || 1000);
  const waybackMs = Math.max(1000, Number(process.env.WAYBACK_RATE_LIMIT_MS || 1000));
  const limiter = new RateLimiter(perHostMs, { hostMinimums: { "web.archive.org": waybackMs } });
  const ttlMs = Number(process.env.GR_CACHE_TTL_HOURS || 168) * HOUR_MS;
  return new CachedFetcher(new RateLimitedFetcher(new UndiciFetcher(), limiter), new FetchCacheRepo(db), ttlMs);
}

const g = globalThis as unknown as { __grServices?: Services };

export function getServices(): Services {
  if (!g.__grServices) {
    const db = getDb();
    const offline = isOffline();
    g.__grServices = { offline, db, runs: new RunsRepo(db), fetcher: buildFetcher(db, offline) };
  }
  return g.__grServices;
}
