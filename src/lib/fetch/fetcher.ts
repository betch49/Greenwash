import { request, interceptors, EnvHttpProxyAgent, type Dispatcher } from "undici";
import type { FetchCacheRepo } from "../db/fetch-cache-repo";
import type { RateLimiter } from "./rate-limiter";

export type FetchSource = "network" | "cache" | "fixture";

export interface FetchResult {
  url: string;
  status: number;
  body: string;
  contentType: string;
  /** ISO time of the original fetch (preserved when served from cache). */
  fetchedAt: string;
  source: FetchSource;
  /** The raw body, set only when the request asked for `binary` (Phase 11: the SBTi .xlsx export); `body` is then "". */
  bytes?: Buffer;
}

export interface FetchOptions {
  headers?: Record<string, string>;
  /** Read the body as bytes (`FetchResult.bytes`) instead of text. Cached as base64 (Phase 11). */
  binary?: boolean;
}

/** Every I/O module receives a Fetcher (ADR-006). */
export interface Fetcher {
  get(url: string, opts?: FetchOptions): Promise<FetchResult>;
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export const USER_AGENT =
  "GreenwashRadar/0.1 (+https://github.com/; evidence-based greenwashing risk signals; respects robots.txt)";

export interface UndiciFetcherOptions {
  userAgent?: string;
  timeoutMs?: number;
  /** Total attempts, including the first. */
  maxTries?: number;
  /** Base backoff when no Retry-After header is present. */
  backoffMs?: number;
  /** Longest wait honoured from a Retry-After header. */
  maxRetryAfterMs?: number;
  dispatcher?: Dispatcher;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const RETRYABLE = new Set([429, 502, 503, 504]);

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Parses a Retry-After header (delta seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | undefined, now: Date): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now.getTime());
}

export class UndiciFetcher implements Fetcher {
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxTries: number;
  private readonly backoffMs: number;
  private readonly maxRetryAfterMs: number;
  private readonly dispatcher: Dispatcher;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(opts: UndiciFetcherOptions = {}) {
    this.userAgent = opts.userAgent ?? USER_AGENT;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxTries = opts.maxTries ?? 3;
    this.backoffMs = opts.backoffMs ?? 1_000;
    this.maxRetryAfterMs = opts.maxRetryAfterMs ?? 60_000;
    this.dispatcher = (opts.dispatcher ?? new EnvHttpProxyAgent()).compose(
      interceptors.redirect({ maxRedirections: 5 }),
    );
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? (() => new Date());
  }

  async get(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
    let lastStatus: number | undefined;
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxTries; attempt++) {
      let waitMs = this.backoffMs * 2 ** (attempt - 1);
      try {
        const res = await request(url, {
          method: "GET",
          dispatcher: this.dispatcher,
          headers: { "user-agent": this.userAgent, accept: "*/*", ...opts.headers },
          headersTimeout: this.timeoutMs,
          bodyTimeout: this.timeoutMs,
        });
        const bytes = opts.binary ? Buffer.from(await res.body.arrayBuffer()) : undefined;
        const body = bytes ? "" : await res.body.text();
        const header = (name: string) => {
          const v = res.headers[name];
          return Array.isArray(v) ? v[0] : v;
        };
        if (!RETRYABLE.has(res.statusCode)) {
          return {
            url,
            status: res.statusCode,
            body,
            contentType: header("content-type") ?? "",
            fetchedAt: this.now().toISOString(),
            source: "network",
            ...(bytes ? { bytes } : {}),
          };
        }
        lastStatus = res.statusCode;
        lastError = undefined;
        const retryAfter = parseRetryAfter(header("retry-after"), this.now());
        if (retryAfter !== undefined) waitMs = Math.min(retryAfter, this.maxRetryAfterMs);
      } catch (err) {
        lastError = err;
        lastStatus = undefined;
      }
      if (attempt < this.maxTries) await this.sleep(waitMs);
    }
    if (lastStatus !== undefined) {
      throw new FetchError(`HTTP ${lastStatus} after ${this.maxTries} tries: ${url}`, url, lastStatus);
    }
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    throw new FetchError(`Network error after ${this.maxTries} tries: ${msg}`, url);
  }
}

/** True for `<origin>/robots.txt`: the URLs whose last cached copy is served when a live fetch fails (ADR-012 amendment). */
export const isRobotsUrl = (url: string): boolean => {
  try {
    return new URL(url).pathname === "/robots.txt";
  } catch {
    return false;
  }
};

/** Serves repeated requests from SQLite; records the original `fetched_at`. */
export class CachedFetcher implements Fetcher {
  constructor(
    private readonly inner: Fetcher,
    private readonly cache: FetchCacheRepo,
    /** Time to live in ms (Infinity = never refetch), or a per-URL policy. */
    private readonly ttlMs: number | ((url: string) => number) = Infinity,
    private readonly now: () => Date = () => new Date(),
    /**
     * URLs for which an expired cache entry is served when the live fetch fails
     * (network error, 5xx, 429). Default: robots.txt only (ADR-012 amendment), so
     * a temporarily unreachable robots.txt does not cost a whole origin; the entry
     * keeps its original `fetched_at`.
     */
    private readonly staleOnError: (url: string) => boolean = isRobotsUrl,
  ) {}

  async get(url: string, opts?: FetchOptions): Promise<FetchResult> {
    const hit = this.cache.get(url);
    const ttl = typeof this.ttlMs === "function" ? this.ttlMs(url) : this.ttlMs;
    const fromCache = (h: NonNullable<typeof hit>): FetchResult => ({
      url,
      status: h.status,
      body: h.encoding === "base64" ? "" : h.body,
      contentType: h.contentType,
      fetchedAt: h.fetchedAt,
      source: "cache",
      ...(h.encoding === "base64" ? { bytes: Buffer.from(h.body, "base64") } : {}),
    });
    if (hit && this.now().getTime() - Date.parse(hit.fetchedAt) <= ttl) return fromCache(hit);
    const stale = hit && this.staleOnError(url) ? hit : undefined;
    let res: FetchResult;
    try {
      res = await this.inner.get(url, opts);
    } catch (err) {
      if (stale) return fromCache(stale);
      throw err;
    }
    if (stale && (res.status >= 500 || res.status === 429)) return fromCache(stale);
    // Only cache definitive answers; transient failures are retried next time.
    if (res.status < 500 && res.status !== 429) {
      this.cache.put({
        url,
        status: res.status,
        body: res.bytes ? res.bytes.toString("base64") : res.body,
        contentType: res.contentType,
        fetchedAt: res.fetchedAt,
        source: res.source,
        encoding: res.bytes ? "base64" : "utf8",
      });
    }
    return res;
  }
}

/** Waits on a per-host RateLimiter before every request. */
export class RateLimitedFetcher implements Fetcher {
  constructor(
    private readonly inner: Fetcher,
    private readonly limiter: RateLimiter,
  ) {}

  async get(url: string, opts?: FetchOptions): Promise<FetchResult> {
    await this.limiter.wait(url);
    return this.inner.get(url, opts);
  }
}
