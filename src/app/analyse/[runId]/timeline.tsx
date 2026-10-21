import { ui } from "@/lib/copy/wording";
import type { TimelineEntry } from "@/lib/wayback/retraction";

/**
 * Minimal archived-claim timeline (PLAN Phase 4 deliverable 7). One list per
 * page, one row per archived copy; every row links to its snapshot (the
 * receipt). The full report UI replaces this in Phase 8.
 */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  const byPage = new Map<string, TimelineEntry[]>();
  for (const e of entries) byPage.set(e.page_url, [...(byPage.get(e.page_url) ?? []), e]);
  return (
    <section aria-labelledby="timeline-heading" data-testid="timeline">
      <h2 id="timeline-heading">{ui.timelineHeading}</h2>
      {entries.length === 0 ? (
        <p className="muted">{ui.timelineNone}</p>
      ) : (
        <>
          <p className="muted">{ui.timelineIntro}</p>
          {[...byPage.entries()].map(([page, rows]) => (
            <div key={page} className="timeline-page" data-page={page}>
              <h3>
                <a href={page} rel="noopener noreferrer">
                  {page}
                </a>
              </h3>
              <ol className="timeline">
                {rows.map((r) => (
                  <li key={r.snapshot_url} data-year={r.year} {...(r.live ? { "data-live": "" } : {})}>
                    <a href={r.snapshot_url} rel="noopener noreferrer">
                      {r.live ? ui.timelineLive(r.snapshot_date) : ui.timelineSnapshot(r.year, r.snapshot_date)}
                    </a>
                    <span className="muted"> — {ui.timelineClaimsPresent(r.claims_present.length)}</span>
                    {r.claims_removed.length > 0 && r.previous_year !== undefined && (
                      <ul className="timeline-removed">
                        {r.claims_removed.map((c) => (
                          <li key={c} data-removed>
                            <strong>{r.live ? ui.timelineRemovedLive(r.previous_year!) : ui.timelineRemoved(r.previous_year!, r.year)}</strong>: “{c}”
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
