import { defaultSleep } from "./fetcher";

/**
 * Spaces calls to the same host by at least `perHostMs`. Slots are reserved
 * synchronously, so concurrent callers are serialised in call order.
 */
export class RateLimiter {
  private readonly nextSlot = new Map<string, number>();

  constructor(
    private readonly perHostMs: number,
    private readonly opts: {
      /** Per-host minimums that override `perHostMs` upwards (e.g. web.archive.org ≥ 1000). */
      hostMinimums?: Record<string, number>;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {}

  intervalFor(host: string): number {
    const min = this.opts.hostMinimums?.[host] ?? 0;
    return Math.max(this.perHostMs, min);
  }

  async wait(url: string): Promise<void> {
    const host = new URL(url).host;
    const now = (this.opts.now ?? Date.now)();
    const at = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, at + this.intervalFor(host));
    if (at > now) await (this.opts.sleep ?? defaultSleep)(at - now);
  }
}
