import { createHash } from "node:crypto";
import { WIKIDATA_API, propsKind } from "./api";

const FILE_PREFIX: Record<string, string> = { full: "entities", classes: "classes", labels: "labels" };

/** Fixture file (relative to fixtures/) for a Wikidata API URL, or null if it is not one. */
export function wikidataFixturePath(url: string): string | null {
  if (!url.startsWith(WIKIDATA_API + "?")) return null;
  const p = new URL(url).searchParams;
  const action = p.get("action");
  if (action === "wbsearchentities") {
    const q = (p.get("search") ?? "").trim().toLowerCase();
    const slug = q.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return slug ? `wikidata/search-${slug}.json` : null;
  }
  if (action === "wbgetentities") {
    const kind = propsKind(p.get("props"));
    if (!kind) return null;
    const ids = (p.get("ids") ?? "").split("|").filter(Boolean).sort();
    const key = ids.length <= 6 ? ids.join("_") : "h" + createHash("sha1").update(ids.join("|")).digest("hex").slice(0, 12);
    return `wikidata/${FILE_PREFIX[kind]}-${key}.json`;
  }
  return null;
}
