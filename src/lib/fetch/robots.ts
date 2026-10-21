import type { FetchOptions, FetchResult, Fetcher } from "./fetcher";
import { reasons, skippedReason } from "../copy/wording";

interface Rule {
  allow: boolean;
  pattern: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
}

export interface Robots {
  groups: Group[];
  /** Absolute URLs from `Sitemap:` lines (they apply to the whole file, not to a group). */
  sitemaps: string[];
}

/** Parses robots.txt per RFC 9309 (groups of user-agent lines followed by allow/disallow rules). */
export function parseRobots(text: string): Robots {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (!current) continue;
      // An empty Disallow means "allow everything" and adds no rule.
      if (value === "") continue;
      current.rules.push({ allow: key === "allow", pattern: value });
    } else {
      if (key === "sitemap" && /^https?:\/\//i.test(value)) sitemaps.push(value);
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + body + (anchored ? "$" : ""));
}

function selectGroup(robots: Robots, userAgent: string): Group | undefined {
  const ua = userAgent.toLowerCase();
  let best: Group | undefined;
  let bestLen = -1;
  for (const g of robots.groups) {
    for (const agent of g.agents) {
      if (agent !== "*" && ua.includes(agent) && agent.length > bestLen) {
        best = g;
        bestLen = agent.length;
      }
    }
  }
  return best ?? robots.groups.find((g) => g.agents.includes("*"));
}

/** Longest matching rule wins; on a tie, Allow wins. No matching rule ⇒ allowed. */
export function isAllowed(robots: Robots, url: string, userAgent = "GreenwashRadar"): boolean {
  const group = selectGroup(robots, userAgent);
  if (!group) return true;
  const u = new URL(url);
  const path = u.pathname + u.search;
  let match: Rule | undefined;
  for (const rule of group.rules) {
    if (!patternToRegExp(rule.pattern).test(path)) continue;
    if (
      !match ||
      rule.pattern.length > match.pattern.length ||
      (rule.pattern.length === match.pattern.length && rule.allow)
    ) {
      match = rule;
    }
  }
  return match ? match.allow : true;
}

export class RobotsDisallowedError extends Error {
  constructor(
    readonly url: string,
    message = `robots.txt disallows ${url}`,
  ) {
    super(message);
    this.name = "RobotsDisallowedError";
  }
}

/** robots.txt could not be read (5xx, network error, not a robots file): the whole origin is disallowed (ADR-012). */
export class RobotsUnavailableError extends RobotsDisallowedError {
  constructor(url: string, reason: string) {
    super(url, reason);
    this.name = "RobotsUnavailableError";
  }
}

/** The robots.txt of one origin, or why it could not be read (then nothing on the origin may be fetched). */
export type RobotsState = { robots: Robots; unavailable?: undefined } | { robots: Robots; unavailable: string };

const EMPTY_ROBOTS: Robots = { groups: [], sitemaps: [] };

/**
 * Interprets the response to `<origin>/robots.txt` per RFC 9309 §2.3.1.3–2.3.1.4 (ADR-012):
 * 2xx robots file ⇒ its rules; 4xx ⇒ no restrictions; 5xx, any other status, or a 2xx
 * that is an HTML page (a bot wall, not a robots file) ⇒ complete disallow.
 */
export function robotsFromResponse(origin: string, res: FetchResult): RobotsState {
  if (res.status >= 400 && res.status < 500) return { robots: EMPTY_ROBOTS };
  if (res.status >= 200 && res.status < 300) {
    const html = /html/i.test(res.contentType) || res.body.trimStart().startsWith("<");
    if (!html) return { robots: parseRobots(res.body) };
    return { robots: EMPTY_ROBOTS, unavailable: reasons.robotsUnavailable(origin, "an HTML page, not a robots file") };
  }
  return { robots: EMPTY_ROBOTS, unavailable: reasons.robotsUnavailable(origin, `HTTP ${res.status}`) };
}

/** Fetches and caches robots.txt per origin; fails closed when it cannot be read (ADR-012). */
export class RobotsChecker {
  private readonly byOrigin = new Map<string, Promise<RobotsState>>();

  constructor(
    private readonly fetcher: Fetcher,
    private readonly userAgent = "GreenwashRadar",
  ) {}

  private robotsFor(origin: string): Promise<RobotsState> {
    let p = this.byOrigin.get(origin);
    if (!p) {
      p = this.fetcher
        .get(`${origin}/robots.txt`)
        .then((res) => robotsFromResponse(origin, res))
        .catch(
          (err: unknown): RobotsState => ({
            robots: EMPTY_ROBOTS,
            unavailable: reasons.robotsUnavailable(origin, err instanceof Error ? err.message : String(err)),
          }),
        );
      this.byOrigin.set(origin, p);
    }
    return p;
  }

  /** Sitemap URLs declared in the origin's robots.txt (empty if none or missing). */
  async sitemaps(origin: string): Promise<string[]> {
    return (await this.robotsFor(origin)).robots.sitemaps;
  }

  /** Why nothing on `origin` may be fetched (robots.txt unreadable), or undefined when its robots.txt was usable. */
  async unavailable(origin: string): Promise<string | undefined> {
    return (await this.robotsFor(origin)).unavailable;
  }

  async check(url: string): Promise<{ allowed: true } | { allowed: false; reason: string; unavailable: boolean }> {
    const state = await this.robotsFor(new URL(url).origin);
    if (state.unavailable) return { allowed: false, reason: state.unavailable, unavailable: true };
    return isAllowed(state.robots, url, this.userAgent)
      ? { allowed: true }
      : { allowed: false, reason: new RobotsDisallowedError(url).message, unavailable: false };
  }
}

/** Refuses to fetch URLs that robots.txt disallows (throws RobotsDisallowedError). */
export class RobotsGuardedFetcher implements Fetcher {
  constructor(
    private readonly inner: Fetcher,
    private readonly checker: RobotsChecker,
  ) {}

  async get(url: string, opts?: FetchOptions): Promise<FetchResult> {
    const verdict = await this.checker.check(url);
    if (!verdict.allowed) {
      throw verdict.unavailable ? new RobotsUnavailableError(url, verdict.reason) : new RobotsDisallowedError(url);
    }
    return this.inner.get(url, opts);
  }
}

/** Converts an error from a fetch into the user-facing "skipped: <reason>" line. */
export function skippedFromError(err: unknown): string {
  return skippedReason(err instanceof Error ? err.message : String(err));
}
