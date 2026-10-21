"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { scoreWording, skippedReason, ui } from "@/lib/copy/wording";
import type { RunView } from "@/lib/pipeline/view";
import { startRun, startRunForm } from "./actions";
import { Timeline } from "@/app/_components/timeline";

const POLL_MS = 800;
const finished = (s: string) => s === "done" || s === "failed";

function StartButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? ui.pending : ui.analyseStart}
    </button>
  );
}

async function fetchView(id: string): Promise<RunView | null> {
  const res = await fetch(`/api/runs/${id}`, { cache: "no-store" });
  return res.ok ? ((await res.json()) as RunView) : null;
}

export function Progress({ initial }: { initial: RunView }) {
  const [view, setView] = useState<RunView>(initial);
  const started = useRef(false);
  const router = useRouter();

  useEffect(() => {
    // QA fix round: a stale page (browser Back, client cache) may say "pending" for a
    // finished run. Re-read the status first; a finished run goes to its report (replace).
    let cancelled = false;
    const sync = async (persisted: boolean) => {
      try {
        const fresh = await fetchView(initial.id);
        if (cancelled || !fresh) return;
        if (fresh.status === "done" && fresh.score && (persisted || initial.status !== "done")) {
          router.replace(`/report/${fresh.score.report_id}`);
          return;
        }
        setView(fresh);
        if (fresh.status === "pending" && !started.current) {
          // Explicit, idempotent start (POST); the GET render of this page never starts anything.
          started.current = true;
          void startRun(initial.id);
        }
      } catch {
        // The poll below retries.
      }
    };
    if (initial.status === "pending") void sync(false);
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) void sync(true);
    };
    window.addEventListener("pageshow", onShow);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", onShow);
    };
  }, [initial.id, initial.status, router]);

  useEffect(() => {
    if (finished(view.status)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const fresh = await fetchView(view.id);
        if (fresh && !cancelled) setView(fresh);
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
      {view.status === "done" && view.score && (
        <p>
          <Link className="button" href={`/report/${view.score.report_id}`} data-testid="open-report">
            {ui.openReport}
          </Link>
        </p>
      )}
      {view.status === "pending" && (
        <form action={startRunForm}>
          <input type="hidden" name="runId" value={view.id} />
          <StartButton />
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
      {view.status === "done" && view.score && (
        <section aria-labelledby="score-heading" data-testid="score">
          <h2 id="score-heading">{scoreWording.scoreHeading}</h2>
          <p className="score-line">
            <strong data-testid="score-line">{scoreWording.scoreLine(view.score.score, view.score.confidence)}</strong> · <span data-testid="score-label">{view.score.label_text}</span>
          </p>
          <p className="muted">
            <span data-testid="ai-share">{scoreWording.aiShare(view.score.ai_share_pct)}</span>. <span data-testid="score-basis">{view.score.basis}</span>{" "}
            <Link href="/methodology">{scoreWording.methodologyLink}</Link>
          </p>
          <h3>{ui.summaryHeading}</h3>
          {view.score.summary ? (
            <>
              <p data-testid="summary">{view.score.summary}</p>
              <p className="muted">{ui.summaryAiNote}</p>
            </>
          ) : (
            <p className="muted" data-testid="summary">
              {ui.summaryUnavailable}
            </p>
          )}
        </section>
      )}
      {finished(view.status) && <Timeline entries={view.timeline ?? []} />}
      {finished(view.status) && (view.could_not_check ?? []).length > 0 && (
        <section aria-labelledby="cnc-heading">
          <h2 id="cnc-heading">{ui.couldNotCheckHeading}</h2>
          <ul className="pages" data-testid="could-not-check">
            {view.could_not_check.map((c, i) => (
              <li key={`${i}-${c}`}>{c}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
