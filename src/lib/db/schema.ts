import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

/** Every external fetch, keyed by URL. `fetched_at` is the time of the original network fetch. */
export const fetchCache = sqliteTable("fetch_cache", {
  url: text("url").primaryKey(),
  status: integer("status").notNull(),
  body: text("body").notNull(),
  contentType: text("content_type").notNull().default(""),
  fetchedAt: text("fetched_at").notNull(),
  source: text("source").notNull(),
});

/** One analysis run, created only after the user confirmed a brand (or pasted a URL). */
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  query: text("query").notNull(),
  brand: text("brand").notNull(),
  website: text("website").notNull(),
  wikidataId: text("wikidata_id"),
  entityJson: text("entity_json"),
  status: text("status").notNull(),
  progress: text("progress").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

/** Brand pages fetched for a run (Phase 2): the receipt source for page-based signals. */
export const runPages = sqliteTable(
  "run_pages",
  {
    runId: text("run_id").notNull(),
    position: integer("position").notNull(),
    url: text("url").notNull(),
    via: text("via").notNull(),
    title: text("title").notNull(),
    text: text("text").notNull(),
    wordCount: integer("word_count").notNull(),
    linksJson: text("links_json").notNull(),
    fetchedAt: text("fetched_at").notNull(),
    source: text("source").notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.url] })],
);

/** Archived-claim timeline of a run (Phase 4): TimelineEntry[] as JSON. Folded into ReportV1 in Phase 6. */
export const runTimeline = sqliteTable("run_timeline", {
  runId: text("run_id").primaryKey(),
  data: text("data").notNull(),
});

/** Finished reports (ReportV1 JSON, Phase 6). */
export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  brand: text("brand").notNull(),
  website: text("website").notNull(),
  data: text("data").notNull(),
  createdAt: text("created_at").notNull(),
});

/** Receipted signals belonging to a run / report. */
export const signals = sqliteTable("signals", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  reportId: text("report_id"),
  axis: text("axis").notNull(),
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  weightHint: real("weight_hint").notNull(),
  sourceUrl: text("source_url").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  excerpt: text("excerpt").notNull(),
  snapshotDate: text("snapshot_date"),
  entityName: text("entity_name"),
  llmUsed: integer("llm_used", { mode: "boolean" }).notNull(),
});

/**
 * Idempotent bootstrap applied when a database is opened. Kept in sync with the
 * Drizzle tables above by tests/unit/db/schema.test.ts.
 */
export const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS fetch_cache (
  url TEXT PRIMARY KEY,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT '',
  fetched_at TEXT NOT NULL,
  source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  brand TEXT NOT NULL,
  website TEXT NOT NULL,
  wikidata_id TEXT,
  entity_json TEXT,
  status TEXT NOT NULL,
  progress TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_pages (
  run_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  url TEXT NOT NULL,
  via TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  links_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  source TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  PRIMARY KEY (run_id, url)
);
CREATE TABLE IF NOT EXISTS run_timeline (
  run_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  brand TEXT NOT NULL,
  website TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  report_id TEXT,
  axis TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  weight_hint REAL NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  snapshot_date TEXT,
  entity_name TEXT,
  llm_used INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS signals_run_idx ON signals(run_id);
CREATE INDEX IF NOT EXISTS reports_brand_idx ON reports(brand);
`;
