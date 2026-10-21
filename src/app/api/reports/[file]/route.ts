import { ReportsRepo } from "@/lib/db/reports-repo";
import { displayStatus } from "@/lib/report/display";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/<id>.json: the stored ReportV1 as saved (every signal with its
 * receipt, the timeline, could-not-check, skipped steps, summary and llm_calls),
 * served as a download (PLAN Phase 8 deliverable 1). Read-only; never runs anything.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const m = /^([0-9a-f-]{36})\.json$/i.exec(file);
  const raw = m ? new ReportsRepo(getServices().db).getRaw(m[1]) : undefined;
  if (!m || !raw) return Response.json({ error: "not found" }, { status: 404 });
  // QA fix round: every number is kept; `display_status` says whether the UI shows the score.
  const report = JSON.parse(raw) as Parameters<typeof displayStatus>[0] & Record<string, unknown>;
  const body = JSON.stringify({ ...report, display_status: displayStatus(report) });
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="greenwash-radar-report-${m[1]}.json"`,
      "cache-control": "no-store",
    },
  });
}
