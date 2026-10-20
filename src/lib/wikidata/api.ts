export const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

export class WikidataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WikidataError";
  }
}

export function searchUrl(query: string, limit: number): string {
  const p = new URLSearchParams({
    action: "wbsearchentities",
    search: query,
    language: "en",
    uselang: "en",
    type: "item",
    limit: String(limit),
    format: "json",
  });
  return `${WIKIDATA_API}?${p.toString()}`;
}

export type EntitiesProps = "full" | "classes" | "labels";

const PROPS: Record<EntitiesProps, string> = {
  full: "labels|descriptions|aliases|claims",
  classes: "labels|claims",
  labels: "labels",
};

export function entitiesUrl(ids: string[], props: EntitiesProps): string {
  const p = new URLSearchParams({
    action: "wbgetentities",
    ids: [...ids].sort().join("|"),
    props: PROPS[props],
    languages: "en|mul",
    format: "json",
  });
  return `${WIKIDATA_API}?${p.toString()}`;
}

export function propsKind(propsParam: string | null): EntitiesProps | null {
  for (const [kind, value] of Object.entries(PROPS)) if (value === propsParam) return kind as EntitiesProps;
  return null;
}
