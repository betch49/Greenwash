# Greenwash Radar

Type a brand name and get an evidence-backed **greenwashing risk signals** score. Every line in the report links to its receipt: the source URL, the fetch date and the raw excerpt. The score is a deterministic formula over those receipts (`config/weights.json`). An AI model may propose candidate claims, classify archived changes and write the summary, but it never sets a number in the score. At most half of the score may depend on AI-assisted signals; the report shows the exact share.

**Signals, not verdicts.** The report says "risk signal", "unsupported claim", "no supporting data found on the fetched page", "claim removed between X and Y", "ruling found naming <entity>". It never says that a brand lies, deceives or is guilty. A high score means the public sources we read contain many risk signals. It is not a legal finding, and a low score is not a certificate. Every term the UI may use is in `src/lib/copy/wording.ts`, and a test (`tests/unit/copy/forbidden.test.ts`) scans every string in `src/` for forbidden wording.

What a report checks:

| Axis | Source | Differentiator |
|---|---|---|
| Claim language | the brand's own pages, rule engine (`src/lib/claims/rules`) | F (baseline) |
| Evidence & certifications | the same pages: impact report links, emissions figures, supplier lists, labels | — |
| Track record | Wayback Machine snapshots (claims removed over time), UK ASA and French JDP rulings | A, C |
| Ownership & repair | the brand's pages (manuals, spare parts, warranty, repair service) and iFixit | E |

The full method, with every weight, is in [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) and on the app's `/methodology` page. Both are generated from `config/weights.json`, and `tests/unit/score/methodology-sync.test.ts` keeps them equal. What the app cannot do is in [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md); design decisions are in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Setup

Requires Node.js 22 (developed on 22.22) and npm. No account and no paid service is needed. The Anthropic API key is optional.

```bash
npm install
cp .env.example .env        # optional: edit the values below
npm run dev                 # http://localhost:3000
```

The SQLite database (`data/greenwash.db` by default) is created on first start. Nothing needs to be migrated.

Behind a TLS-intercepting proxy, set `NODE_EXTRA_CA_CERTS` to the proxy's CA bundle. Outbound requests honour `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`.

### Environment variables

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | unset | Turns on the three AI-assisted steps (candidate claims, archived-change classification, summary). Without it, outside offline mode, they show `skipped: LLM unavailable (no API key)` and the report uses the rule-based signals only. |
| `GR_LLM_MODEL` | `claude-sonnet-5-5` (`config/llm.json`) | The model id for the AI steps. |
| `WAYBACK_RATE_LIMIT_MS` | `1000` | Spacing between requests to web.archive.org. Values below 1000 are raised to 1000 (≤ 1 request per second). |
| `GR_RATE_LIMIT_MS` | `1000` | Spacing between requests to any one other host. |
| `GR_REPORT_TTL_HOURS` | `168` | How long a stored report is re-served to a new search for the same brand (see "Cache"). `0` turns re-serving off. |
| `GR_CACHE_TTL_HOURS` | `168` | How long a fetched page, API answer or CDX listing is reused from the fetch cache. Archived snapshots are kept forever. |
| `GR_DB_PATH` | `data/greenwash.db` | The SQLite file (fetch cache, runs, reports). |
| `GR_OFFLINE_FIXTURES` | unset | `1` = offline fixture mode (below). |
| `GR_FIXED_NOW` | unset | Offline mode only: pins the pipeline clock (ISO date-time). The tests use `2026-10-20T00:00:00Z`. Ignored in live runs. |
| `GR_RECORD_LLM` | unset | Offline mode with a key: `1` records the missing LLM fixtures from the real API. |
| `GR_FIXTURES_DIR`, `GR_LLM_FIXTURES_DIR` | `fixtures`, `fixtures/llm` | Fixture locations. |
| `GR_TEST_ROUTES` | unset | `1` exposes `/api/runs/count` (test helper) outside offline mode. |

### Offline fixture mode

```bash
GR_OFFLINE_FIXTURES=1 GR_FIXED_NOW=2026-10-20T00:00:00Z npm run dev
```

In this mode, every fetch is answered from `fixtures/` and never from the network. That covers Wikidata, brand pages, robots.txt, Wayback, ASA, JDP and iFixit. The LLM is answered from `fixtures/llm/`. A URL with no recording answers HTTP 404. This is the mode all tests use. Brands you can try:

- `mammut sports group`, `fairphone`, `oatly`: real brands. Their pages, Wikidata answers and regulator and iFixit answers were captured from the live sites (`fixtures/brands/README.md`, `fixtures/sources/README.md`).
- `continental`: shows the confirmation cards.
- `acme`: has no Wikidata match. You then paste a website:
  - `https://www.northwind-outdoor.example`, the fictional Northwind Outdoor. Its Wayback history is synthetic and it has two removed claims.
  - `https://www.quillmoor-foods.example`, the fictional Quillmoor Foods.

  These two brands are on reserved `.example` domains. Their content is marked `synthetic fixture` and no real company published it.

Offline mode is a test mode. The LLM answers in `fixtures/llm/` are hand-authored stand-ins, not model output (see LIMITATIONS).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3000. |
| `npm run build` / `npm start` | Production build / server. |
| `npm run lint` | ESLint. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Vitest unit and module tests (offline, mocked LLM, temporary databases; no network). |
| `npm run test:e2e` | Playwright. It starts `next dev` on port 3123 in offline fixture mode with the pinned clock and a throw-away database (`test-results/e2e.db`). If the browser is missing, run `npx playwright install chromium` first. |
| `npm run lighthouse` | Needs `npm run build` first. Starts `next start` offline, makes a Fairphone report and runs Lighthouse (accessibility) on `/`, `/confirm` (cards and URL fallback), `/report/[id]` and `/methodology`. Writes `docs/phases/8-lighthouse.json` and exits 1 below 90. `CHROME_PATH` overrides the browser. |
| `npm run e2e:real -- <brand> [--website https://…]` | One **live** run against a real brand. It starts `next dev` without fixtures on `test-results/real.db`, then searches, confirms the first card (or pastes `--website` when Wikidata offers none), waits for the run and opens the report. It then times three report GETs and a second identical search, which must be re-served from cache in under 1 s. Writes `docs/phases/9-real-run.json`. Uses the real API when `ANTHROPIC_API_KEY` is set. |
| `npm run record:wikidata -- <queries…>` | Re-record Wikidata fixtures (live network). |
| `npm run record:brand -- <slug> <query> <sector>` | Re-record a brand's pages (live, robots-guarded, 1 req/s). |
| `npm run record:sources` | Re-record the ASA, JDP and iFixit fixtures (live). |
| `npm run author:llm` | Regenerate the hand-authored LLM stand-ins in `fixtures/llm/`. It prints the score and `ai_share` per brand. |
| `scripts/smoke.sh` | Fresh-clone check: `npm ci && npm run build`, then `npm run dev` must serve `/` with HTTP 200 within 30 s with no error output. |

The fixture files are keyed by a hash of the exact input. If you change a page fixture, an LLM input builder or the report the summary reads, run `npm run author:llm` again. With a key, record real answers instead: `GR_OFFLINE_FIXTURES=1 GR_RECORD_LLM=1 ANTHROPIC_API_KEY=… npm run author:llm`, after deleting the stale files.

## How a run works

1. **Search and confirm.** Wikidata `wbsearchentities` plus entity data (website, country, industry, logo). A single clear match proceeds; otherwise the user confirms a card. With no usable match, the user pastes the website.
2. **Analyse.** `/analyse/<runId>` starts the pipeline with an explicit POST and shows each step as it runs. A step that cannot run shows `skipped: <reason>`; it is never hidden.
   - Discover pages: robots.txt, sitemap and heuristic paths. Fetch at most 12 pages.
   - Claim language, then published evidence.
   - Wayback snapshots, one per year over eight years, at most three pages. Removed claims are found, including removals between the newest snapshot and the live page.
   - ASA and JDP rulings.
   - Repair information and iFixit.
   - The AI steps.
   - Score.
3. **Report.** `/report/<id>`: score, label, confidence and AI share; four axes with receipts; the timeline; "What we could not check"; skipped steps; the AI call log; share link; JSON download (`/api/reports/<id>.json`); re-run.

### Cache and report identity (ADR-022)

Every external fetch is cached in SQLite with its fetch time, and robots.txt and rate limits are respected. A finished report is stored as `ReportV1` JSON.

A new search is redirected to a stored report, with nothing re-run, when that report is younger than `GR_REPORT_TTL_HOURS` and has the same brand identity:

- the **same website**: a spelling with and without a trailing slash counts as one; **and**
- the **same confirmed Wikidata entity**, or, for a pasted website, the **same typed name** (case-insensitive).

A report made under another name or entity is never served for a search. "Re-run the analysis" always starts a new run. `/report/<id>` and the JSON export only ever read the stored report; they carry `x-gr-served-from: cache`.

## Adding a regulator adapter

1. Implement `RegulatorAdapter` (`src/lib/regulators/adapter.ts`) in a new file next to `asa-uk.ts` / `jdp-fr.ts`:
   - `searchUrl`, `search` (parse the search page into `RulingCandidate[]`) and `fetchRuling` (parse one ruling page into a `Ruling`, with the ruled entity verbatim).
   - Fetch through `getRegulatorPage`, so robots.txt and failures become a shown `skipped:` reason.
   - Put the URLs in `config/regulators.json`.
2. Add the adapter's id to the `id` union. Add a step with `makeRegulatorStep(adapter, steps.<name>)` in `src/lib/pipeline/steps/regulators.ts`, and list it in `src/lib/pipeline/run.ts`. Add the step label to `steps` in `wording.ts`.
3. Matching is shared (`src/lib/regulators/match.ts`): a ruling is scored only when the ruled entity's name equals the brand after normalisation, and a partial match is shown as "possible", never scored. Do not write a looser matcher.
4. Record real fixtures by adding a case to `scripts/record-sources.ts`, then `npm run record:sources`. Never hand-write a page under a real URL (ADR-011). Add parser tests like `tests/unit/regulators/asa-uk.test.ts`.
5. Update `couldNotCheck.regulatorCoverage` in `wording.ts`, METHODOLOGY Section 9 and LIMITATIONS.

## Limits

The main ones are listed here; [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) has every one, with the reason and what the user sees.

- **Regulators.** Only the UK ASA and the French JDP are searched.
- **Brand pages.**
  - Pages are fetched without JavaScript rendering.
  - At most 12 pages per brand.
  - The claim rules are English only.
  - A claim counts as substantiated only by data on the same page.
- **Wayback.** The live Wayback Machine path was not verified from the build environment (web.archive.org was unreachable). The three real fixture brands therefore have no archived history; the removed-claim cases use fictional brands.
- **AI steps.** They have not been run against the real API (no key in the build environment). The LLM fixtures are hand-authored stand-ins.
- **Scale.** Single process, single SQLite file. A run interrupted by a restart is marked failed and must be searched again.
