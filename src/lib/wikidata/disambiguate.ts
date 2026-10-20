import config from "../../../config/wikidata.json";
import type { Fetcher } from "../fetch/fetcher";
import { resolveEntities } from "./entities";
import { rankCandidates, type RankResult } from "./rank";
import { searchEntities } from "./search";

/** Search → entities → rank. Never starts any analysis; the caller asks the user to confirm. */
export async function disambiguate(fetcher: Fetcher, query: string): Promise<RankResult> {
  const q = query.trim();
  if (!q) return { confident: null, candidates: [] };
  const hits = await searchEntities(fetcher, q, config.searchLimit);
  const entities = await resolveEntities(
    fetcher,
    hits.map((h) => h.id),
  );
  return rankCandidates(q, entities);
}

/** Re-resolves one entity id (served from cache) so the server never trusts client-sent fields. */
export async function candidateById(fetcher: Fetcher, query: string, id: string) {
  const result = await disambiguate(fetcher, query);
  return result.candidates.find((c) => c.id === id) ?? null;
}
