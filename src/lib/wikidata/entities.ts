import type { Fetcher } from "../fetch/fetcher";
import { WikidataError, entitiesUrl, type EntitiesProps } from "./api";

interface Snak {
  snaktype: string;
  datavalue?: { type: string; value: unknown };
}
interface Claim {
  mainsnak: Snak;
  rank?: "preferred" | "normal" | "deprecated";
}
export interface RawEntity {
  id: string;
  missing?: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  aliases?: Record<string, { value: string }[]>;
  claims?: Record<string, Claim[]>;
}

export interface Ref {
  id: string;
  label: string;
}

/** A Wikidata item resolved into the fields the app uses. */
export interface WikidataEntity {
  id: string;
  label: string;
  description?: string;
  aliases: string[];
  /** P856 official website (first non-deprecated, preferred first; among normal rank, https before http). */
  website?: string;
  /** P749 parent organisation. */
  parent?: Ref;
  /** P452 industry. */
  industries: Ref[];
  /** P17 country. */
  countries: Ref[];
  /** P154 logo, as a Wikimedia Commons file URL. */
  logo?: string;
  /** P31 instance of. */
  instanceOf: Ref[];
  /** P279 of each P31 class (one level up), keyed by class id. */
  classParents: Record<string, string[]>;
  /** P946 ISIN and P1278 LEI (Phase 11: SBTi identifier matching); absent when the item has none. */
  isins?: string[];
  leis?: string[];
}

const CHUNK = 50;

export async function getEntities(fetcher: Fetcher, ids: string[], props: EntitiesProps): Promise<Record<string, RawEntity>> {
  const unique = [...new Set(ids)];
  const out: Record<string, RawEntity> = {};
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const res = await fetcher.get(entitiesUrl(chunk, props), { headers: { accept: "application/json" } });
    if (res.status !== 200) throw new WikidataError(`Wikidata entities returned HTTP ${res.status}`);
    let data: { entities?: Record<string, RawEntity>; error?: { code: string } };
    try {
      data = JSON.parse(res.body);
    } catch {
      throw new WikidataError("Wikidata entities returned invalid JSON");
    }
    if (data.error) throw new WikidataError(`Wikidata entities error: ${data.error.code}`);
    for (const [id, e] of Object.entries(data.entities ?? {})) if (e.missing === undefined) out[id] = e;
  }
  return out;
}

function claimValues(e: RawEntity, prop: string): unknown[] {
  const claims = (e.claims?.[prop] ?? []).filter((c) => c.rank !== "deprecated" && c.mainsnak.snaktype === "value");
  const preferred = claims.filter((c) => c.rank === "preferred");
  return (preferred.length ? [...preferred, ...claims.filter((c) => c.rank !== "preferred")] : claims).map(
    (c) => c.mainsnak.datavalue?.value,
  );
}

/** P856: the first preferred-rank value; otherwise the first https value of normal rank, then the first value. */
function officialWebsite(e: RawEntity): string | undefined {
  const sites = strings(e, "P856");
  const preferred = (e.claims?.P856 ?? []).some((c) => c.rank === "preferred" && c.mainsnak.snaktype === "value");
  if (preferred) return sites[0];
  return sites.find((s) => /^https:\/\//i.test(s)) ?? sites[0];
}

function itemIds(e: RawEntity, prop: string): string[] {
  return claimValues(e, prop)
    .map((v) => (v && typeof v === "object" && "id" in v ? String((v as { id: string }).id) : null))
    .filter((v): v is string => !!v);
}

function strings(e: RawEntity, prop: string): string[] {
  return claimValues(e, prop).filter((v): v is string => typeof v === "string");
}

/** English label, falling back to the default-for-all-languages ("mul") label. */
const label = (e: RawEntity | undefined, fallback: string) =>
  e?.labels?.en?.value ?? e?.labels?.mul?.value ?? fallback;

const nonEmpty = <K extends string>(key: K, values: string[]): Partial<Record<K, string[]>> => (values.length ? ({ [key]: values } as Record<K, string[]>) : {});

export function commonsFileUrl(fileName: string): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName.replace(/ /g, "_"))}`;
}

/**
 * `wbgetentities` for the search hits, then the P31 classes (with their P279),
 * then English labels for the referenced industry / country / parent items.
 */
export async function resolveEntities(fetcher: Fetcher, ids: string[]): Promise<WikidataEntity[]> {
  if (ids.length === 0) return [];
  const full = await getEntities(fetcher, ids, "full");
  const classIds = new Set<string>();
  const refIds = new Set<string>();
  for (const e of Object.values(full)) {
    itemIds(e, "P31").forEach((id) => classIds.add(id));
    [...itemIds(e, "P452"), ...itemIds(e, "P17"), ...itemIds(e, "P749").slice(0, 1)].forEach((id) => refIds.add(id));
  }
  const classes = classIds.size ? await getEntities(fetcher, [...classIds], "classes") : {};
  for (const id of classIds) refIds.delete(id);
  const labels = refIds.size ? await getEntities(fetcher, [...refIds], "labels") : {};
  const lookup = (id: string): Ref => ({ id, label: label(labels[id] ?? classes[id], id) });

  return ids
    .filter((id) => full[id])
    .map((id) => {
      const e = full[id];
      const instanceOf = itemIds(e, "P31");
      const logo = strings(e, "P154")[0];
      const parentId = itemIds(e, "P749")[0];
      return {
        id,
        label: label(e, id),
        description: e.descriptions?.en?.value ?? e.descriptions?.mul?.value,
        aliases: [...(e.aliases?.en ?? []), ...(e.aliases?.mul ?? [])].map((a) => a.value),
        website: officialWebsite(e),
        parent: parentId ? lookup(parentId) : undefined,
        industries: itemIds(e, "P452").map(lookup),
        countries: itemIds(e, "P17").map(lookup),
        logo: logo ? commonsFileUrl(logo) : undefined,
        instanceOf: instanceOf.map((c) => ({ id: c, label: label(classes[c], c) })),
        classParents: Object.fromEntries(instanceOf.map((c) => [c, classes[c] ? itemIds(classes[c], "P279") : []])),
        ...nonEmpty("isins", strings(e, "P946")),
        ...nonEmpty("leis", strings(e, "P1278")),
      };
    });
}
