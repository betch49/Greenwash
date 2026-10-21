"use server";

import { startAnalysis } from "@/lib/pipeline/start";

/**
 * Explicit start of the analysis (POST via server action). Idempotent per run:
 * only the first call for a pending run starts the pipeline.
 */
export async function startRun(runId: string): Promise<{ started: boolean }> {
  return { started: startAnalysis(String(runId)) };
}

/** No-JS fallback: the "Start analysis" form posts here. */
export async function startRunForm(formData: FormData): Promise<void> {
  startAnalysis(String(formData.get("runId") ?? ""));
}
