import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { RunsRepo } from "@/lib/db/runs-repo";
import { openDb } from "@/lib/db/client";
import { tempDb } from "../helpers/db";

describe("database bootstrap", () => {
  let env: ReturnType<typeof tempDb>;
  beforeEach(() => {
    env = tempDb();
  });
  afterEach(() => env.cleanup());

  it("creates every Drizzle table with the same columns", () => {
    for (const table of [schema.fetchCache, schema.runs, schema.runPages, schema.reports, schema.signals]) {
      const name = getTableName(table);
      const cols = env.db.$client.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
      const expected = Object.values(getTableColumns(table)).map((c) => c.name);
      expect(cols.map((c) => c.name).sort(), name).toEqual([...expected].sort());
    }
  });

  it("is idempotent (bootstrap can run twice)", () => {
    expect(() => env.db.$client.exec(schema.BOOTSTRAP_SQL)).not.toThrow();
  });

  it("creates, reads and counts runs", () => {
    const repo = new RunsRepo(env.db);
    expect(repo.count()).toBe(0);
    const run = repo.create({ query: "patagonia", brand: "Patagonia, Inc.", website: "https://www.patagonia.com", wikidataId: "Q1660552" });
    expect(repo.count()).toBe(1);
    const back = repo.get(run.id);
    expect(back?.brand).toBe("Patagonia, Inc.");
    expect(back?.progress).toEqual([]);
  });

  it("honours GR_DB_PATH via openDb on an in-memory database", () => {
    const db = openDb(":memory:");
    expect(new RunsRepo(db).count()).toBe(0);
    db.$client.close();
  });
});
