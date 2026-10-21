import type { Fetcher } from "../fetch/fetcher";
import { WikidataError, searchUrl } from "./api";

export interface SearchHit {
  id: string;
  label: string;
  description?: string;
  match?: { type: string; text: string };
  aliases?: string[];
}

interface SearchResponse {
  search?: { id: string; label?: string; description?: string; match?: { type: string; text: string }; aliases?: string[] }[];
  error?: { code: string; info: string };
}

/** `wbsearchentities`: free-text search for items. */
export async function searchEntities(fetcher: Fetcher, query: string, limit = 7): Promise<SearchHit[]> {
  const res = await fetcher.get(searchUrl(query, limit), { headers: { accept: "application/json" } });
  if (res.status !== 200) throw new WikidataError(`Wikidata search returned HTTP ${res.status}`);
  let data: SearchResponse;
  try {
    data = JSON.parse(res.body) as SearchResponse;
  } catch {
    throw new WikidataError("Wikidata search returned invalid JSON");
  }
  if (data.error) throw new WikidataError(`Wikidata search error: ${data.error.code}`);
  return (data.search ?? []).map((h) => ({
    id: h.id,
    label: h.label ?? h.id,
    description: h.description,
    match: h.match,
    aliases: h.aliases,
  }));
}
