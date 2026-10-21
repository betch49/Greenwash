// The only module that imports the SQLite driver (ADR-005).
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export const DEFAULT_DB_PATH = "data/greenwash.db";

/** Opens (and bootstraps) a database at `path`. Use ":memory:" or a temp file in tests. */
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(schema.BOOTSTRAP_SQL);
  for (const add of schema.ADDED_COLUMNS) {
    const cols = sqlite.prepare(`PRAGMA table_info(${add.table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === add.column)) sqlite.exec(add.ddl);
  }
  return drizzle(sqlite, { schema }) as Db;
}

const globalForDb = globalThis as unknown as { __grDb?: { path: string; db: Db } };

/** Process-wide database honouring GR_DB_PATH. */
export function getDb(): Db {
  const path = process.env.GR_DB_PATH || DEFAULT_DB_PATH;
  if (!globalForDb.__grDb || globalForDb.__grDb.path !== path) {
    globalForDb.__grDb = { path, db: openDb(path) };
  }
  return globalForDb.__grDb.db;
}
