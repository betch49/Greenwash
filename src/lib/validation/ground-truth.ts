// Validation ground truth (PLAN Phase 10, docs/SOURCES.md "how an entry is made", ADR-025).
//
// EVALUATION ONLY. The labels in fixtures/validation/ground-truth.json say which
// brands third parties have flagged and which carry positive markers; they are
// read by the validation harness (scripts/validate.ts) and by tests, never by
// the pipeline or the scorer. tests/unit/validation/isolation.test.ts pins that
// nothing else under src/ imports this module or reads the file (criterion 10.4).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** Source register keys (docs/SOURCES.md). `role` on a citation says whether it flags or is a positive marker. */
export const CITATION_SOURCES = ["changing_markets", "asa", "jdp", "sabin", "sbti", "newclimate", "fti", "netzerotracker", "bcorp"] as const;
export type CitationSource = (typeof CITATION_SOURCES)[number];

/** Sources that may flag a brand (SOURCES.md "flagged"). */
export const FLAG_SOURCES: readonly CitationSource[] = ["changing_markets", "asa", "jdp", "sabin", "sbti", "newclimate"];
/** Sources that may give a positive marker (SOURCES.md "well_rated"). */
export const POSITIVE_SOURCES: readonly CitationSource[] = ["sbti", "newclimate", "fti", "netzerotracker", "bcorp"];
/** Citations that may be unverified from the build container (NewClimate answers 403, B Corp is Cloudflare-challenged). */
export const UNVERIFIABLE_SOURCES: readonly CitationSource[] = ["newclimate", "bcorp"];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const httpUrl = z.string().url().refine((u) => /^https?:\/\//.test(u), "url must be http(s)");

export const CitationSchema = z.object({
  source: z.enum(CITATION_SOURCES),
  role: z.enum(["flag", "positive"]),
  url: httpUrl,
  /** Capture date of the cited page (the recorder sets it when it fetches the page). */
  date: isoDate,
  why: z.string().trim().min(1),
  verified_from_container: z.boolean(),
  /** The recorded copy, relative to fixtures/validation/ (absent only when not verified). */
  file: z.string().min(1).optional(),
});

/** A check for a flag that found none (well-rated entries): what was looked at and what it said. */
export const CheckSchema = z.object({
  source: z.enum(CITATION_SOURCES),
  url: httpUrl,
  date: isoDate,
  result: z.string().trim().min(1),
  file: z.string().min(1).optional(),
});

export const GROUPS = ["flagged", "well_rated", "contested"] as const;
export type Group = (typeof GROUPS)[number];

export const EntrySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** The query typed in the app (defaults to `name`). */
  query: z.string().min(1).optional(),
  wikidata_id: z.string().regex(/^Q\d+$/).optional(),
  website: httpUrl,
  group: z.enum(GROUPS),
  citations: z.array(CitationSchema).min(1),
  checks: z.array(CheckSchema).default([]),
  /** Slug of the offline brand fixture (fixtures/brands/<fixture>/) when one exists. */
  fixture: z.string().regex(/^[a-z0-9-]+$/).optional(),
});

export const GroundTruthSchema = z.object({
  version: z.literal(1),
  label_use: z.literal("evaluation_only"),
  $comment: z.string().optional(),
  entries: z.array(EntrySchema),
});

export type Citation = z.infer<typeof CitationSchema>;
export type Entry = z.infer<typeof EntrySchema>;
export type GroundTruth = z.infer<typeof GroundTruthSchema>;

export const GROUND_TRUTH_PATH = join("fixtures", "validation", "ground-truth.json");

/** Parses and checks a ground-truth document; throws on any rule violation. */
export function parseGroundTruth(raw: unknown): GroundTruth {
  const gt = GroundTruthSchema.parse(raw);
  if (gt.label_use !== "evaluation_only") throw new Error("ground truth must be evaluation_only");
  const problems = groundTruthProblems(gt);
  if (problems.length) throw new Error(`invalid ground truth:\n- ${problems.join("\n- ")}`);
  return gt;
}

/** Loads fixtures/validation/ground-truth.json (or `path`). */
export function loadGroundTruth(path: string = join(process.cwd(), GROUND_TRUTH_PATH)): GroundTruth {
  return parseGroundTruth(JSON.parse(readFileSync(path, "utf8")));
}

const flags = (e: Entry) => e.citations.filter((c) => c.role === "flag");
/** Positive markers count per distinct source (two citations from one source are one marker). */
export const positiveMarkers = (e: Entry) => new Set(e.citations.filter((c) => c.role === "positive").map((c) => c.source)).size;

/** Rule violations that the zod schema cannot express (SOURCES.md rules). */
export function groundTruthProblems(gt: GroundTruth): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of gt.entries) {
    if (seen.has(e.slug)) out.push(`${e.slug}: slug appears twice`);
    seen.add(e.slug);
    if (/\.example(\/|$)/i.test(new URL(e.website).host + "/")) out.push(`${e.slug}: fictional .example brands are never in the ground truth`);
    for (const c of e.citations) {
      if (!c.verified_from_container && !UNVERIFIABLE_SOURCES.includes(c.source)) out.push(`${e.slug}: an unverified citation is allowed only for newclimate or bcorp (${c.url})`);
      if (c.role === "flag" && !FLAG_SOURCES.includes(c.source)) out.push(`${e.slug}: ${c.source} cannot flag a brand`);
      if (c.role === "positive" && !POSITIVE_SOURCES.includes(c.source)) out.push(`${e.slug}: ${c.source} is not a positive marker`);
    }
    const nFlags = flags(e).length;
    const nMarkers = positiveMarkers(e);
    if (e.group === "flagged" && nFlags === 0) out.push(`${e.slug}: flagged without a flag citation`);
    if (e.group === "flagged" && nMarkers >= 2) out.push(`${e.slug}: a flag plus two positive markers is contested, not flagged`);
    if (e.group === "well_rated" && nFlags > 0) out.push(`${e.slug}: well_rated with a flag citation`);
    if (e.group === "well_rated" && nMarkers < 2) out.push(`${e.slug}: well_rated needs two positive markers from different sources`);
    if (e.group === "contested" && (nFlags === 0 || nMarkers < 2)) out.push(`${e.slug}: contested needs a flag and two positive markers`);
  }
  return out;
}

/** Entries of one group. */
export const ofGroup = (gt: GroundTruth, g: Group) => gt.entries.filter((e) => e.group === g);
