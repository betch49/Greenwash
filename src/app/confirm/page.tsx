import Link from "next/link";
import { redirect } from "next/navigation";
import { ui } from "@/lib/copy/wording";
import { getServices } from "@/lib/services";
import { disambiguate } from "@/lib/wikidata/disambiguate";
import type { Candidate, RankResult } from "@/lib/wikidata/rank";
import { confirmCandidate, startFromUrl } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function describe(c: Candidate): string {
  return [c.description ?? c.industry, c.country, c.websiteHost].filter(Boolean).join(", ");
}

function rejectHref(q: string, rejected: string[], id: string): string {
  const p = new URLSearchParams({ q, reject: [...rejected, id].join(",") });
  return `/confirm?${p.toString()}`;
}

export default async function ConfirmPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = one(params.q).trim();
  if (!q) redirect("/");
  const rejected = one(params.reject).split(",").filter(Boolean);
  const forceUrl = one(params.mode) === "url";
  const urlError = one(params.error) === "url";

  const { fetcher, runs } = getServices();
  let result: RankResult = { confident: null, candidates: [] };
  let lookupError: string | null = null;
  if (!forceUrl) {
    try {
      result = await disambiguate(fetcher, q);
    } catch (err) {
      lookupError = err instanceof Error ? err.message : String(err);
    }
  }

  const c = result.confident;
  if (c && c.website && !rejected.includes(c.id)) {
    const run = runs.create({ query: q, brand: c.name, website: c.website, wikidataId: c.id, entity: c });
    redirect(`/analyse/${run.id}`);
  }

  const remaining = result.candidates.filter((x) => !rejected.includes(x.id));
  const showUrl = remaining.length === 0;

  return (
    <>
      {remaining.length > 0 && (
        <section aria-labelledby="confirm-heading">
          <h1 id="confirm-heading">{ui.confirmHeading(q)}</h1>
          <ul className="cards">
            {remaining.map((cand) => (
              <li key={cand.id} className="card" data-candidate={cand.id}>
                <p>
                  {ui.didYouMean} <strong>{cand.name}</strong>
                  {describe(cand) ? ` — ${describe(cand)}` : ""}?
                </p>
                <div className="card-actions">
                  {cand.website ? (
                    <form action={confirmCandidate}>
                      <input type="hidden" name="q" value={q} />
                      <input type="hidden" name="id" value={cand.id} />
                      <button type="submit">{ui.confirm}</button>
                    </form>
                  ) : null}
                  <Link className="button button-secondary" href={rejectHref(q, rejected, cand.id)} prefetch={false}>
                    {ui.notThisOne}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {showUrl && (
        <section aria-labelledby="url-heading">
          <h1 id="url-heading">
            {rejected.length > 0 && result.candidates.length > 0 ? ui.allRejectedHeading : ui.notFoundHeading(q)}
          </h1>
          {lookupError && <p className="muted">{ui.lookupFailed(lookupError)}</p>}
          <form action={startFromUrl}>
            <input type="hidden" name="q" value={q} />
            <label htmlFor="url">{ui.urlLabel}</label>
            <div className="field-row">
              <input
                id="url"
                name="url"
                type="text"
                inputMode="url"
                required
                placeholder="https://example.com"
                aria-invalid={urlError || undefined}
                aria-describedby={urlError ? "url-error" : undefined}
              />
              <button type="submit">{ui.urlButton}</button>
            </div>
            {urlError && (
              <p id="url-error" className="error" role="alert">
                {ui.urlInvalid}
              </p>
            )}
          </form>
        </section>
      )}
      <p>
        <Link href="/">Search for another brand</Link>
      </p>
    </>
  );
}
