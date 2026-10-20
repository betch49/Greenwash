import Link from "next/link";
import { notFound } from "next/navigation";
import { ui } from "@/lib/copy/wording";
import { getServices } from "@/lib/services";
import { displayHost } from "@/lib/website";

export const dynamic = "force-dynamic";

export default async function AnalysePage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = getServices().runs.get(runId);
  if (!run) notFound();
  return (
    <>
      <h1>{ui.analyseHeading(run.brand)}</h1>
      <dl className="facts">
        <dt>Brand</dt>
        <dd data-testid="brand">{run.brand}</dd>
        <dt>Website</dt>
        <dd data-testid="website">
          <a href={run.website} rel="noopener noreferrer">
            {displayHost(run.website)}
          </a>
        </dd>
        {run.wikidataId && (
          <>
            <dt>Wikidata</dt>
            <dd>
              <a href={`https://www.wikidata.org/wiki/${run.wikidataId}`} rel="noopener noreferrer">
                {run.wikidataId}
              </a>
            </dd>
          </>
        )}
      </dl>
      <p className="muted">{ui.analysePlaceholder}</p>
      <p>
        <Link href="/">Search for another brand</Link>
      </p>
    </>
  );
}
