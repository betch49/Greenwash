import type { FetchOptions, FetchResult, Fetcher } from "./fetcher";
import { skippedReason } from "../copy/wording";

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
}

/** Parses robots.txt per RFC 9309 (groups of user-agent lines followed by allow/disallow rules). */
export function parseRobots(text: string): Robots {
  const groups: Group[] = [];
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
      lastWasAgent = false;
    }
  }
  return { groups };
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
  constructor(readonly url: string) {
    super(`robots.txt disallows ${url}`);
    this.name = "RobotsDisallowedError";
  }
}

/** Fetches and caches robots.txt per origin; a missing or failing robots.txt allows everything. */
export class RobotsChecker {
  private readonly byOrigin = new Map<string, Promise<Robots>>();

  constructor(
    private readonly fetcher: Fetcher,
    private readonly userAgent = "GreenwashRadar",
  ) {}

  private robotsFor(origin: string): Promise<Robots> {
    let p = this.byOrigin.get(origin);
    if (!p) {
      p = this.fetcher
        .get(`${origin}/robots.txt`)
        .then((res) => (res.status >= 200 && res.status < 300 ? parseRobots(res.body) : { groups: [] }))
        .catch(() => ({ groups: [] }));
      this.byOrigin.set(origin, p);
    }
    return p;
  }

  async check(url: string): Promise<{ allowed: true } | { allowed: false; reason: string }> {
    const robots = await this.robotsFor(new URL(url).origin);
    return isAllowed(robots, url, this.userAgent)
      ? { allowed: true }
      : { allowed: false, reason: new RobotsDisallowedError(url).message };
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
    if (!verdict.allowed) throw new RobotsDisallowedError(url);
    return this.inner.get(url, opts);
  }
}

/** Converts an error from a fetch into the user-facing "skipped: <reason>" line. */
export function skippedFromError(err: unknown): string {
  if (err instanceof RobotsDisallowedError) return skippedReason(err.message);
  return skippedReason(err instanceof Error ? err.message : String(err));
}
