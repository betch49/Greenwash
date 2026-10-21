import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "exceljs"],
  poweredByHeader: false,
  // A report page and its JSON export are always read from the stored ReportV1 in SQLite,
  // never computed by a pipeline run (PLAN Phase 8 deliverable 2, criterion 8.5).
  async headers() {
    return [
      { source: "/report/:id", headers: [{ key: "x-gr-served-from", value: "cache" }] },
      { source: "/api/reports/:file", headers: [{ key: "x-gr-served-from", value: "cache" }] },
    ];
  },
};

export default nextConfig;
