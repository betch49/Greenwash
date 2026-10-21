import { ReportsRepo } from "../db/reports-repo";
import { getServices, pipelineClock } from "../services";
import { freshReportId, reportTtlHours, type BrandIdentity } from "./cache";

/**
 * The report to re-serve for a brand (website + Wikidata entity, or website + typed name) instead of starting a new run, if one is
 * fresh. "Now" is the pipeline clock, the same clock that stamped the report.
 */
export function cachedReportFor(who: BrandIdentity): string | undefined {
  return freshReportId(new ReportsRepo(getServices().db), who, pipelineClock()(), reportTtlHours());
}
