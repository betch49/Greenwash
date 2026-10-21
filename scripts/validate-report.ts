// Validates an exported report file (GET /api/reports/<id>.json) against ReportV1.
// Usage: npx tsx scripts/validate-report.ts <file.json>
// Prints {"ok":true,"signals":N,...} or exits 1 with the zod error.
import { readFileSync } from "node:fs";
import { ReportV1Schema } from "../src/lib/score/report";

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx scripts/validate-report.ts <file.json>");
  process.exit(2);
}
const parsed = ReportV1Schema.safeParse(JSON.parse(readFileSync(file, "utf8")));
if (!parsed.success) {
  console.error(JSON.stringify(parsed.error.issues, null, 2));
  process.exit(1);
}
const r = parsed.data;
console.log(
  JSON.stringify({
    ok: true,
    signals: r.axes.reduce((n, a) => n + a.signals.length, 0),
    signal_ids: r.axes.flatMap((a) => a.signals.map((s) => s.id)),
    signals_count: r.signals_count,
    llm_calls: r.llm_calls.length,
    could_not_check: r.could_not_check.length,
  }),
);
