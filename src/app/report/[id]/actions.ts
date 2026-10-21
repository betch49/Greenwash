"use server";

import { redirect } from "next/navigation";
import { ReportsRepo } from "@/lib/db/reports-repo";
import { getServices } from "@/lib/services";

/**
 * "Re-run": a new run for the same brand and website as the stored report,
 * bypassing the report cache (PLAN Phase 8 deliverable 2). Works without JavaScript.
 */
export async function rerunReport(formData: FormData): Promise<void> {
  const id = String(formData.get("reportId") ?? "");
  const { db, runs } = getServices();
  const report = new ReportsRepo(db).get(id);
  if (!report) redirect("/");
  const old = runs.get(report.run_id);
  const run = runs.create({
    query: old?.query ?? report.brand,
    brand: report.brand,
    website: report.website,
    wikidataId: old?.wikidataId ?? null,
    entity: old?.entity ?? undefined,
  });
  redirect(`/analyse/${run.id}`);
}
