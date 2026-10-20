import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.GR_E2E_PORT || 3123);
const DB = "test-results/e2e.db";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Offline: every fetch goes to fixtures/, the LLM to the mock (ADR-006).
    command: `rm -f ${DB} ${DB}-wal ${DB}-shm && npx next dev -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    // GR_FIXED_NOW pins the pipeline clock (offline only) so the Wayback year window is 2019–2026 forever.
    env: { GR_OFFLINE_FIXTURES: "1", GR_FIXED_NOW: "2026-10-20T00:00:00Z", GR_DB_PATH: DB, NEXT_TELEMETRY_DISABLED: "1" },
  },
});
