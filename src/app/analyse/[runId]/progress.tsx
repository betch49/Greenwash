"use client";

import { useEffect, useRef, useState } from "react";
import { skippedReason, ui } from "@/lib/copy/wording";
import type { RunView } from "@/lib/pipeline/view";
import { startRun, startRunForm } from "./actions";

const POLL_MS = 800;
const finished = (s: string) => s === "done" || s === "failed";

export function Progress({ initial }: { initial: RunView }) {
  const [view, setView] = useState<RunView>(initial);
  const started = useRef(false);

  useEffect(() => {
    // Explicit, idempotent start (POST); the GET render of this page never starts anything.
    if (initial.status === "pending" && !started.current) {
      started.current = true;
      void startRun(initial.id);
    }
  }, [initial.id, initial.status]);

  useEffect(() => {
    if (finished(view.status)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/runs/${view.id}`, { cache: "no-store" });
        if (res.ok && !cancelled) setView((await res.json()) as RunView);
      } catch {
        // Retry on the next tick.
        if (!cancelled) setView((v) => ({ ...v }));
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [view]);

  const statusLine =
    view.status === "pending" ? ui.analyseNotStarted : view.status === "running" ? ui.analyseRunning : view.status === "done" ? ui.analyseDone : ui.analyseFailed;

  return (
    <>
      <p className="muted" role="status" aria-live="polite" data-testid="run-status" data-status={view.status}>
        {statusLine}
      </p>
      {view.status === "pending" && (
        <form action={startRunForm}>
          <input type="hidden" name="runId" value={view.id} />
          <button type="submit">{ui.analyseStart}</button>
        </form>
      )}
      <section aria-labelledby="progress-heading">
        <h2 id="progress-heading">{ui.progressHeading}</h2>
        <ol className="progress" data-testid="progress">
          {view.progress.map((p, i) => (
            <li key={`${i}-${p.step}`} data-step={p.step} data-status={p.status} className={`progress-${p.status}`}>
              <span className="progress-step">{p.step}</span>{" "}
              <span className="progress-status">
                {p.status === "done" ? ui.statusDone : p.status === "running" ? ui.statusRunning : skippedReason(p.reason ?? "")}
              </span>
            </li>
          ))}
        </ol>
      </section>
      {finished(view.status) && (
        <section aria-labelledby="pages-heading">
          <h2 id="pages-heading">{ui.pagesHeading(view.pages.length)}</h2>
          {view.pages.length === 0 ? (
            <p className="muted">{ui.pagesNone}</p>
          ) : (
            <ul className="pages" data-testid="pages">
              {view.pages.map((p) => (
                <li key={p.url}>
                  <a href={p.url} rel="noopener noreferrer">
                    {p.title || p.url}
                  </a>
                  <span className="muted">
                    {" "}
                    — {ui.words(p.wordCount)}, {ui.fetchedOn(p.fetchedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
