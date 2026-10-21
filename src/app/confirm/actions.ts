"use server";

import { redirect } from "next/navigation";
import { cachedReportFor } from "@/lib/report/serve";
import { createOnce, dedupeKey } from "@/lib/run-dedupe";
import { getServices } from "@/lib/services";
import { resolveSite } from "@/lib/site-name";
import { candidateById } from "@/lib/wikidata/disambiguate";
import { capQuery, normaliseWebsite } from "@/lib/website";

/** The user confirmed one candidate card. The entity is re-resolved server side. */
export async function confirmCandidate(formData: FormData): Promise<void> {
  const q = capQuery(String(formData.get("q") ?? ""));
  const id = String(formData.get("id") ?? "");
  const { fetcher, runs } = getServices();
  const candidate = q && id ? await candidateById(fetcher, q, id) : null;
  if (!candidate || !candidate.website) {
    redirect(`/confirm?q=${encodeURIComponent(q)}&mode=url`);
  }
  const cached = cachedReportFor({ website: candidate.website, wikidataId: candidate.id });
  if (cached) redirect(`/report/${cached}`);
  const runId = createOnce(runs, dedupeKey({ website: candidate.website, brand: candidate.name, wikidataId: candidate.id }), () =>
    runs.create({
      query: q,
      brand: candidate.name,
      website: candidate.website!,
      wikidataId: candidate.id,
      entity: candidate,
    }),
  );
  redirect(`/analyse/${runId}`);
}

/**
 * URL fallback: the user pasted the brand's website. The display name comes from
 * the fetched homepage (og:site_name or <title>), else the domain; a bare domain
 * that cannot be fetched is retried with www. (QA fix round).
 */
export async function startFromUrl(formData: FormData): Promise<void> {
  const q = capQuery(String(formData.get("q") ?? ""));
  const pasted = normaliseWebsite(String(formData.get("url") ?? ""));
  if (!pasted) {
    redirect(`/confirm?q=${encodeURIComponent(q)}&mode=url&error=url`);
  }
  const { fetcher, runs } = getServices();
  const { website, name: brand } = await resolveSite(fetcher, pasted);
  const cached = cachedReportFor({ website, brand });
  if (cached) redirect(`/report/${cached}`);
  const runId = createOnce(runs, dedupeKey({ website, brand }), () => runs.create({ query: q, brand, website }));
  redirect(`/analyse/${runId}`);
}
