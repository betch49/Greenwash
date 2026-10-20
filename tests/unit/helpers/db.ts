import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "@/lib/db/client";

/** A fresh temp-file database per suite. */
export function tempDb(): { db: Db; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "gr-test-"));
  const db = openDb(join(dir, "test.db"));
  return {
    db,
    cleanup: () => {
      db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
