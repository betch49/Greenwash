import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Timeline } from "@/app/_components/timeline";
import { POSSIBLE_MATCH_PREFIX, reportWording as w, scoreWording, skippedReason, ui } from "@/lib/copy/wording";
import { ReportsRepo } from "@/lib/db/reports-repo";
import type { ReportV1 } from "@/lib/score/report";
import { signalPoints } from "@/lib/score/scorer";
import { WEIGHTS } from "@/lib/score/weights";
import { getServices } from "@/lib/services";
import { displayHost } from "@/lib/website";
import { rerunReport } from "./actions";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type Signal = ReportV1["axes"][number]["signals"][number];

const day = (iso: string) => iso.slice(0, 10);
const pct = (x: number) => Math.round(x * 100);

/** The stored report: the page never runs the pipeline (PLAN Phase 8 deliverable 2). */
function load(id: string): ReportV1 | undefined {
  try {
    return new ReportsRepo(getServices().db).get(id);
  } catch {
    return undefined;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const report = load((await params).id);
  return { title: report ? `${w.title(report.brand)} · ${ui.appName}` : w.notFound };
}

/** The P154 logo, shown only online (never from fixtures, never in offline test mode; Phase 1 review). */
function logoOf(runId: string): string | undefined {
  const { offline, runs } = getServices();
  if (offline) return undefined;
  const entity = runs.get(runId)?.entity as { logo?: unknown } | null | undefined;
  return typeof entity?.logo === "string" && /^https:\/\//.test(entity.logo) ? entity.logo : undefined;
}

function wikidataOf(runId: string): string | null {
  return getServices().runs.get(runId)?.wikidataId ?? null;
}

async function shareUrl(id: string): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}/report/${id}`;
}

function isProtective(s: Signal): boolean {
  return (WEIGHTS.points[s.axis] as Record<string, number>)[s.kind] === 0;
}

function SignalRow({ s }: { s: Signal }) {
  const points = Math.round(signalPoints(s) * 100) / 100;
  return (
    <li className="receipt" data-signal={s.id} data-kind={s.kind} {...(s.llm_used ? { "data-llm": "" } : {})}>
      <p className="receipt-label">
        <strong>{s.label}</strong>
        {s.llm_used && (
          <>
            {" "}
            <span className="badge" title={w.aiAssistedTitle}>
              {w.aiAssisted}
            </span>
          </>
        )}
      </p>
      <blockquote className="excerpt" data-excerpt>
        {s.excerpt}
      </blockquote>
      <p className="receipt-meta">
        {w.source}:{" "}
        <a href={s.source_url} rel="noopener noreferrer" data-source>
          {s.source_url}
        </a>
        <br />
        <span data-fetched>{w.fetched(day(s.fetched_at))}</span>
        {s.snapshot_date && <> · {w.archived(s.snapshot_date)}</>}
        {s.entity_name && <> · {w.entity(s.entity_name)}</>}
        {" · "}
        <span data-points={points}>{points === 0 && isProtective(s) ? w.protectivePoints : w.points(points)}</span>
      </p>
    </li>
  );
}

export default async function ReportPage({ params }: { params: Params }) {
  const { id } = await params;
  const report = load(id);
  if (!report) notFound();
  const logo = logoOf(report.run_id);
  const wikidataId = wikidataOf(report.run_id);
  const share = await shareUrl(id);
  const possible = report.could_not_check.filter((c) => c.startsWith(POSSIBLE_MATCH_PREFIX));
  const notChecked = report.could_not_check.filter((c) => !c.startsWith(POSSIBLE_MATCH_PREFIX));

  return (
    <article className="report" data-testid="report" data-report-id={id}>
      <header className="report-header">
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="logo" src={logo} alt={w.logoAlt(report.brand)} width={64} height={64} loading="lazy" />
        )}
        <div>
          <h1>{w.heading(report.brand)}</h1>
          <p className="muted">
            {w.website}:{" "}
            <a href={report.website} rel="noopener noreferrer" data-testid="website">
              {displayHost(report.website)}
            </a>
            {wikidataId && (
              <>
                {" · "}
                {w.wikidata}:{" "}
                <a href={`https://www.wikidata.org/wiki/${wikidataId}`} rel="noopener noreferrer">
                  {wikidataId}
                </a>
              </>
            )}
            {" · "}
            <span data-testid="generated">{w.generated(day(report.generated_at))}</span>
          </p>
        </div>
      </header>

      <section aria-labelledby="headline-heading" className="headline" data-testid="headline">
        <h2 id="headline-heading" className="visually-hidden">
          {w.headlineHeading}
        </h2>
        <p className="score-big">
          <span data-testid="score">{report.score}</span>
          <span className="score-of"> {w.scoreOutOf}</span>
        </p>
        <p className="score-label" data-testid="score-label" data-label={report.label}>
          {report.label_text}
        </p>
        <p data-testid="score-basis">{report.basis}</p>
        <p data-testid="score-line">{scoreWording.scoreLine(report.score, report.confidence)}</p>
        <p data-testid="ai-share">{scoreWording.aiShare(pct(report.ai_share))}</p>
        <p>
          <Link href="/methodology">{scoreWording.methodologyLink}</Link>
        </p>
      </section>

      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading">{ui.summaryHeading}</h2>
        {report.summary ? (
          <>
            <p data-testid="summary">{report.summary.text}</p>
            <p className="muted" data-testid="summary-note">
              {ui.summaryAiNote}
            </p>
          </>
        ) : (
          <p className="muted" data-testid="summary">
            {ui.summaryUnavailable}
          </p>
        )}
      </section>

      <section aria-labelledby="axes-heading">
        <h2 id="axes-heading">{w.axesHeading}</h2>
        {report.axes.map((a) => (
          <section key={a.id} className="axis" data-axis={a.id} data-status={a.status} aria-labelledby={`axis-${a.id}`}>
            <h3 id={`axis-${a.id}`}>{scoreWording.axisNames[a.id]}</h3>
            <p className="axis-meta">
              <strong data-testid={`subscore-${a.id}`}>{w.axisSubscore(a.subscore)}</strong> · {w.axisWeight(pct(a.weight), pct(a.effective_weight))} ·{" "}
              <span data-axis-status>{scoreWording.axisStatus[a.status]}</span> · {w.receiptsCount(a.signals.length)}
            </p>
            {a.signals.length === 0 ? (
              <p className="muted">{w.noReceipts}</p>
            ) : (
              <ol className="receipts">
                {a.signals.map((s) => (
                  <SignalRow key={s.id} s={s} />
                ))}
              </ol>
            )}
          </section>
        ))}
      </section>

      <Timeline entries={report.timeline} />

      <section aria-labelledby="cnc-heading">
        <h2 id="cnc-heading">{ui.couldNotCheckHeading}</h2>
        <ul className="pages" data-testid="could-not-check">
          {notChecked.map((c, i) => (
            <li key={`${i}-${c}`}>{c}</li>
          ))}
        </ul>
        {possible.length > 0 && (
          <>
            <h3>{w.possibleHeading}</h3>
            <p className="muted">{w.possibleIntro}</p>
            <ul className="pages" data-testid="possible-matches">
              {possible.map((c, i) => (
                <li key={`${i}-${c}`} data-possible>
                  {c}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="skipped-heading">
        <h2 id="skipped-heading">{w.skippedHeading}</h2>
        {report.skipped.length === 0 ? (
          <p className="muted">{w.skippedNone}</p>
        ) : (
          <ul className="pages" data-testid="skipped">
            {report.skipped.map((s, i) => (
              <li key={`${i}-${s.step}`}>
                <strong>{s.step}</strong>: {skippedReason(s.reason)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="llm-heading">
        <h2 id="llm-heading">{w.llmCallsHeading}</h2>
        {report.llm_calls.length === 0 ? (
          <p className="muted">{w.llmCallsNone}</p>
        ) : (
          <ul className="pages" data-testid="llm-calls">
            {report.llm_calls.map((c, i) => (
              <li key={`${i}-${c.name}`}>{w.llmCall(c.name, c.used_fixture, c.status)}</li>
            ))}
          </ul>
        )}
        <p className="muted">{w.llmCallsNote}</p>
      </section>

      <section aria-labelledby="share-heading" className="share">
        <h2 id="share-heading">{w.shareHeading}</h2>
        <p>
          {w.shareLabel}:{" "}
          <a href={share} data-testid="share-link">
            {share}
          </a>
        </p>
        <p>
          <a className="button" href={`/api/reports/${id}.json`} download={`greenwash-radar-report-${id}.json`} data-testid="download-json">
            {w.download}
          </a>
        </p>
        <p className="muted">{w.rerunNote(day(report.generated_at))}</p>
        <form action={rerunReport}>
          <input type="hidden" name="reportId" value={id} />
          <button type="submit" className="button-secondary">
            {w.rerun}
          </button>
        </form>
        <p>
          <Link href="/">{w.newSearch}</Link>
        </p>
      </section>
    </article>
  );
}
