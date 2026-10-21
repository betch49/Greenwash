# QA fix round: UX fixes from exploratory QA

A QA fix round, not a plan phase: no change to scope, weights or differentiators.
Nothing here changes a number in the score; the stored report keeps every number.
Not touched (other builders were editing them in parallel): `src/lib/score/**`,
`config/weights.json`, `config/discovery.json`, `src/lib/regulators/**`, `src/lib/registries/**`.

## What was built

1. **No-evidence reports (HIGH).** New `config/report.json` (`minConfidenceToLabel`, default 40)
   and `src/lib/report/display.ts`. When the confidence is below the threshold or no page was
   fetched, the report page shows "Not enough evidence to score this brand" instead of the
   number and label. Axes that are not scored show "—" instead of "0/100". The JSON export
   (`/api/reports/<id>.json`) keeps every number and adds `display_status`
   (`"scored"` or `"insufficient_evidence"`).
2. **Summaries (HIGH).** `npm run author:llm` now covers innocent, Signify, Essity and
   TotalEnergies too (hand-authored stand-ins, labelled in each file's `source`, ADR-011/021).
   A deterministic rule-based fallback summary (`fallbackSummary` in `src/lib/report/display.ts`)
   is shown when the AI summary is unavailable, labelled "Automatic summary (no AI)": a fixed
   template over the report's own receipts, citing only receipt URLs, filtered by the
   forbidden-word list. Skipped-step lines no longer repeat the step name in the reason.
3. **Lookup error heading (MED).** A Wikidata error now heads the page with "We couldn’t look
   this brand up right now." instead of "We could not find a company called …".
4. **URL typed in the search box (MED).** `/confirm` detects a website (`looksLikeUrl`) and goes
   straight to URL mode with the field prefilled.
5. **URL-fallback naming (MED).** `startFromUrl` fetches the homepage (`src/lib/site-name.ts`)
   and names the run after `og:site_name` or the cleaned `<title>`, else the domain; a bare
   domain that cannot be fetched is retried with `www.`.
6. **Double submit (MED).** Submit buttons are disabled while pending (`useFormStatus`,
   `src/app/_components/submit-button.tsx`); the server dedupes identical run creation within
   15 s while the first run is pending or running (`src/lib/run-dedupe.ts`).
7. **Back to /analyse (MED).** The progress component re-reads the run status on mount (when the
   page says pending) and on `pageshow` from the back/forward cache; a finished run goes to its
   report with `router.replace`. The run is started only after that re-read says pending.
8. **Long queries (LOW).** `maxLength=100` on the search input, `capQuery` server side,
   headings truncated to 60 characters.
10. **Copy (LOW, partial).** A Wayback 404 now reads "Wayback Machine: no archived copies found";
   "not verified in v1" became "the label itself was not checked against its issuer"; the report
   headline shows the score once (the second line is now "Confidence N%").

## Skipped and why

- **9 (auto-redirect when an analysis finishes):** skipped for the deadline. Many Playwright
  specs read the finished /analyse page (pages list, progress, score line); redirecting would
  need them all rewritten. Item 7 covers the stale-page case.
- **10, methodology page (human labels next to code ids, condensed phone layout):** skipped for
  the deadline.
- **Playwright run:** not run in this round (no browser installed in the build sandbox); the e2e
  specs whose expected text changed were updated by hand (`full-flow`, `llm`, `search-confirm`).

## How to verify

- `npm run lint && npm run typecheck && npm test && npm run build`
- `tests/unit/report/qa-fixes.test.ts`: display status, step-prefix strip, fallback summary,
  site naming, www retry, URL detection, query cap, run dedupe.
- Manual: search "acme", paste `northwind-outdoor.example`: the run is named
  "Northwind Outdoor Clothing & Gear" and uses `https://www.northwind-outdoor.example`.
- `GR_E2E_PORT=3511 npm run test:e2e` where Playwright browsers are installed.
