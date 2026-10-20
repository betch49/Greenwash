"use server";

import { redirect } from "next/navigation";
import { getServices } from "@/lib/services";
import { candidateById } from "@/lib/wikidata/disambiguate";
import { displayHost, normaliseWebsite } from "@/lib/website";

/** The user confirmed one candidate card. The entity is re-resolved server side. */
export async function confirmCandidate(formData: FormData): Promise<void> {
  const q = String(formData.get("q") ?? "").trim();
  const id = String(formData.get("id") ?? "");
  const { fetcher, runs } = getServices();
  const candidate = q && id ? await candidateById(fetcher, q, id) : null;
  if (!candidate || !candidate.website) {
    redirect(`/confirm?q=${encodeURIComponent(q)}&mode=url`);
  }
  const run = runs.create({
    query: q,
    brand: candidate.name,
    website: candidate.website,
    wikidataId: candidate.id,
    entity: candidate,
  });
  redirect(`/analyse/${run.id}`);
}

/** URL fallback: the user pasted the brand's website. */
export async function startFromUrl(formData: FormData): Promise<void> {
  const q = String(formData.get("q") ?? "").trim();
  const website = normaliseWebsite(String(formData.get("url") ?? ""));
  if (!website) {
    redirect(`/confirm?q=${encodeURIComponent(q)}&mode=url&error=url`);
  }
  const { runs } = getServices();
  const run = runs.create({ query: q, brand: q || displayHost(website), website });
  redirect(`/analyse/${run.id}`);
}
