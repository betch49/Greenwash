import { DISCOVERY_CONFIG, type DiscoveryConfig } from "../discover/heuristics";

export type RepairApplicability = { applicable: true; industry?: string } | { applicable: false; industry: string };

/** The Wikidata P452 industry label a run's confirmed entity carries (Phase 1 Candidate.industry), if any. */
export function entityIndustry(entity: unknown): string | undefined {
  if (!entity || typeof entity !== "object") return undefined;
  const industry = (entity as { industry?: unknown }).industry;
  return typeof industry === "string" && industry.trim() ? industry.trim() : undefined;
}

/**
 * Food, drink and other consumables (industry label in config/discovery.json
 * nonDurableIndustries, exact, case-insensitive) ⇒ the repair axis is not
 * applicable: not scored, listed under "What we could not check". No industry on
 * record (URL fallback, or Wikidata has none) ⇒ applicable: repair information is
 * looked for, and its absence is a risk signal only on a brand we did not rule out.
 */
export function repairApplicability(entity: unknown, config: Pick<DiscoveryConfig, "nonDurableIndustries"> = DISCOVERY_CONFIG): RepairApplicability {
  const industry = entityIndustry(entity);
  if (!industry) return { applicable: true };
  const list = new Set((config.nonDurableIndustries ?? []).map((s) => s.toLowerCase()));
  return list.has(industry.toLowerCase()) ? { applicable: false, industry } : { applicable: true, industry };
}
