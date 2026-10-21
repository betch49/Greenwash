// iFixit lookup (Phase 5, axis E). iFixit's robots.txt disallows /api/* except
// /api/2.0/categories*, /api/2.0/guides* and /api/2.0/wikis* (checked 2026-10-20),
// so the brand is looked up through the device-category endpoint
// /api/2.0/wikis/CATEGORY/<name> instead of /api/2.0/search (docs/CHALLENGES.md C-2).
// Every request goes through the robots-guarded fetcher.
import { createHash } from "node:crypto";
import config from "../../../config/repair.json";
import { couldNotCheck, reasons, signalLabels, steps } from "../copy/wording";
import type { ProgressEntry } from "../db/runs-repo";
import { FetchError, type Fetcher } from "../fetch/fetcher";
import { RobotsDisallowedError } from "../fetch/robots";
import type { Signal } from "../pipeline/signal";
import { normaliseEntity, searchQuery } from "../regulators/match";

export const ifixitCategoryUrl = (title: string) => config.ifixit.categoryUrl.replace("{title}", encodeURIComponent(title));

interface CategoryChild {
  title?: string;
  display_title?: string;
  url?: string;
}

/** The fields of an iFixit CATEGORY wiki this module reads. */
export interface IfixitCategory {
  title: string;
  display_title?: string;
  description?: string;
  children?: CategoryChild[];
  guides?: { title?: string }[];
  repairability_score?: number | null;
}

export interface IfixitResult {
  signals: Signal[];
  progress: ProgressEntry[];
  could_not_check: string[];
  /** Set when iFixit could not be used at all (shown as a could-not-check line; the repair step continues). */
  skipped?: string;
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const REPAIR_WEIGHT_HINT = 1;

function signal(kind: string, label: string, url: string, fetchedAt: string, excerpt: string): Signal {
  return { id: `repair-${kind.replace(/^repair\./, "")}-${hash(`${url} ${excerpt}`)}`, axis: "repair", kind, label, weight_hint: REPAIR_WEIGHT_HINT, source_url: url, fetched_at: fetchedAt, excerpt, llm_used: false };
}

class IfixitUnavailable extends Error {}

/** One category, or null when iFixit has none by that name (404). */
async function getCategory(fetcher: Fetcher, title: string): Promise<{ url: string; fetchedAt: string; data: IfixitCategory } | null> {
  const url = ifixitCategoryUrl(title);
  let res;
  try {
    res = await fetcher.get(url, { headers: { accept: "application/json" } });
  } catch (err) {
    if (err instanceof RobotsDisallowedError) throw new IfixitUnavailable(err.message);
    if (err instanceof FetchError) throw new IfixitUnavailable(reasons.ifixitUnreachable(err.status ? `HTTP ${err.status}` : err.message));
    throw new IfixitUnavailable(reasons.ifixitUnreachable(err instanceof Error ? err.message : String(err)));
  }
  if (res.status === 404) return null;
  if (res.status !== 200) throw new IfixitUnavailable(reasons.ifixitUnreachable(`HTTP ${res.status}`));
  let data: IfixitCategory;
  try {
    data = JSON.parse(res.body) as IfixitCategory;
  } catch {
    throw new IfixitUnavailable(reasons.ifixitUnreachable("not JSON"));
  }
  if (!data || typeof data.title !== "string") throw new IfixitUnavailable(reasons.ifixitUnreachable("unexpected response"));
  return { url, fetchedAt: res.fetchedAt, data };
}

const nameOf = (c: { title?: string; display_title?: string }) => (c.display_title || c.title || "").trim();

/**
 * Looks the brand up on iFixit. Conservative: the category's title must be the
 * brand's name (same normalisation as regulator matching), otherwise nothing is
 * attributed. Signals (all protective, axis repair, receipt = the API response):
 * `repair.ifixit_devices` (device categories listed for the brand),
 * `repair.ifixit_guides` per device read (guide titles in the excerpt) and
 * `repair.ifixit_score` when iFixit publishes a repairability score for the device.
 */
export async function lookupIfixit(brand: string, fetcher: Fetcher, opts: { maxDevices?: number; maxGuideTitles?: number } = {}): Promise<IfixitResult> {
  const maxDevices = opts.maxDevices ?? config.ifixit.maxDevices;
  const maxTitles = opts.maxGuideTitles ?? config.ifixit.maxGuideTitles;
  const out: IfixitResult = { signals: [], progress: [], could_not_check: [] };
  const query = searchQuery(brand);
  let top;
  try {
    top = await getCategory(fetcher, query);
  } catch (err) {
    if (!(err instanceof IfixitUnavailable)) throw err;
    out.skipped = err.message;
    out.could_not_check.push(couldNotCheck.ifixitSkipped(err.message));
    return out;
  }
  if (!top || normaliseEntity(top.data.title) !== normaliseEntity(brand)) {
    out.could_not_check.push(couldNotCheck.ifixitSkipped(reasons.ifixitNotListed(query)));
    return out;
  }
  const brandName = nameOf(top.data);
  const children = (top.data.children ?? []).filter((c) => nameOf(c));
  if (children.length > 0) {
    const names = children.map(nameOf);
    const excerpt = `${brandName}: ${top.data.description ?? ""} Devices: ${names.join(", ")}`.replace(/\s+/g, " ").trim();
    out.signals.push(signal("repair.ifixit_devices", signalLabels.ifixitDevices(children.length, brandName), top.url, top.fetchedAt, excerpt));
  }
  const devices = children.length > 0 ? children.slice(-maxDevices) : [{ title: top.data.title, display_title: top.data.display_title }];
  for (const child of devices) {
    let dev = child.title === top.data.title ? top : null;
    if (!dev) {
      try {
        dev = await getCategory(fetcher, child.title ?? nameOf(child));
      } catch (err) {
        if (!(err instanceof IfixitUnavailable)) throw err;
        out.progress.push({ step: steps.ifixit, status: "skipped", reason: err.message });
        continue;
      }
    }
    if (!dev) continue;
    const device = nameOf(dev.data);
    const guides = (dev.data.guides ?? []).map((g) => (g.title ?? "").trim()).filter(Boolean);
    if (guides.length > 0) {
      const shown = guides.slice(0, maxTitles).join("; ");
      out.signals.push(signal("repair.ifixit_guides", signalLabels.ifixitGuides(device, guides.length), dev.url, dev.fetchedAt, `${device}: ${shown}${guides.length > maxTitles ? "; …" : ""}`));
    }
    const score = dev.data.repairability_score;
    if (typeof score === "number" && Number.isFinite(score)) {
      out.signals.push(signal("repair.ifixit_score", signalLabels.ifixitScore(device, score), dev.url, dev.fetchedAt, `${device}: repairability score ${score}/10`));
    }
  }
  return out;
}
