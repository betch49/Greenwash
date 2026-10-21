import { listSnapshots } from "@/lib/wayback/cdx";
import { fetchSnapshot, type Snapshot } from "@/lib/wayback/snapshot";
import { OfflineFetcher } from "../helpers/brands";

export const NOW = new Date("2026-10-20T12:00:00Z");

/** The archived history of a fixture page, served offline from fixtures/brands/<slug>/cdx + snapshots. */
export async function fixtureHistory(pageUrl: string, fetcher = new OfflineFetcher()): Promise<Snapshot[]> {
  const list = await listSnapshots(pageUrl, fetcher, NOW);
  const out: Snapshot[] = [];
  for (const s of list.snapshots) {
    const r = await fetchSnapshot(pageUrl, s, fetcher);
    if (r.ok) out.push(r.snapshot);
  }
  return out;
}

export const NORTHWIND_FOOTPRINT = "https://www.northwind-outdoor.example/our-footprint/";
export const QUILLMOOR_SUSTAINABILITY = "https://www.quillmoor-foods.example/sustainability";
