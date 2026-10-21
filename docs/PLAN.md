# Greenwash Radar — Plan (Phase 0 output)

Written by the director 2026-10-20. Executable by the builder with no further input. Every acceptance criterion names the test that proves it. Phases are sized for one builder session each. Phase 0 (this document, BRAINSTORM, DECISIONS, LATER) is complete.

Differentiators (ADR-002): **A** claim retraction (Wayback), **C** regulator rulings (ASA UK, JDP FR), **E** ownership & repair, plus **F** claim-language engine with same-page substantiation.

## Conventions binding every phase

- **Stack:** Next.js 15 App Router + TypeScript (strict), Drizzle + `better-sqlite3` (ADR-005), `undici`, `cheerio`, `diff`, `zod`, Vitest, Playwright. Plain CSS, system font stack, `prefers-color-scheme`. No component library. No Python.
- **Layout:**
  ```
  src/app/                  routes: /, /confirm, /analyse/[runId], /report/[id], /methodology, /api/...
  src/lib/db/               schema.ts, client.ts (only place that imports better-sqlite3), repos
  src/lib/fetch/            fetcher.ts (Fetcher interface, undici impl, cached wrapper, robots, rate limit), fixture-fetcher.ts
  src/lib/wikidata/         search.ts, entities.ts, rank.ts
  src/lib/discover/         sitemap.ts, heuristics.ts, visible-text.ts
  src/lib/claims/           rules/*.ts, engine.ts, substantiation.ts, evidence-rules.ts, lexicon.ts
  src/lib/wayback/          cdx.ts, snapshot.ts, diff.ts, retraction.ts
  src/lib/regulators/       adapter.ts (interface), asa-uk.ts, jdp-fr.ts, match.ts
  src/lib/repair/           ifixit.ts, brand-pages.ts
  src/lib/llm/              client.ts (interface), anthropic.ts, mock.ts, schemas.ts, extract.ts, classify-diff.ts, summary.ts
  src/lib/score/            weights.json, scorer.ts, ai-share.ts, confidence.ts
  src/lib/pipeline/         run.ts (orchestrates steps, emits progress), signal.ts (Signal type), steps/*.ts
  src/lib/copy/             wording.ts (all signal templates), forbidden.ts
  config/weights.json       symlinked/imported by src/lib/score (single source of weights)
  fixtures/brands/<slug>/   meta.json, pages/*.html, snapshots/<page-slug>/<YYYYMMDD>.html, regulators/asa.html, regulators/jdp.html, repair/ifixit.json, repair/*.html
  fixtures/wikidata/        search-<q>.json, entities-<ids>.json
  fixtures/llm/             <call>-<hash>.json
  tests/unit/               vitest
  tests/e2e/                playwright
  docs/phases/<n>.md        builder's phase note
  ```
- **Signal type** (`src/lib/pipeline/signal.ts`), exactly as brief Section 5 plus `id`, `label`, `entity_name?`:
  `{ id, axis: 'claims'|'evidence'|'track'|'repair', kind, label, weight_hint: number, source_url, fetched_at: ISO string, excerpt, snapshot_date?, entity_name?, llm_used: boolean }`.
  A signal missing `source_url`, `fetched_at` or non-empty `excerpt` is rejected by `assertReceipt()` and never stored or scored (tested in Phase 2 and enforced at the scorer in Phase 6).
- **Steps** return `{ signals: Signal[], skipped?: { step, reason }, could_not_check: string[] }`. A step that throws is caught by the pipeline and converted into `skipped: <reason>`; it never hides.
- **DI:** every I/O module takes `Fetcher` and (where relevant) `LLMClient` as parameters. `GR_OFFLINE_FIXTURES=1` makes the app wire `FixtureFetcher` + `MockLLM`.
- **Fixture brands** (builder chooses the exact brands in Phase 2 and records them in `fixtures/brands/README.md`): one outdoor apparel (**Mammut**, `www.mammut.com`; Patagonia was the first choice but bot-blocks the build container, see ADR-011), one electronics (one that iFixit covers: **Fairphone**), one food (**Oatly**). All three are real saved HTML. A synthetic fixture is allowed only for a fictional brand on a reserved domain (`northwind`, `www.northwind-outdoor.example`), marked `<!-- synthetic fixture -->`, and is test-only (ADR-011). *Renamed by the director in the Phase 2 round-2 review; not a re-plan.*
- **Wording:** every user-facing signal string comes from `src/lib/copy/wording.ts`; the forbidden-word test (Phase 3) runs from then on.
- **Every phase:** `npm run lint && npm run typecheck && npm test` green (Playwright from Phase 1: `npm run test:e2e`). Commit `phase <n>: <title>`, push, write `docs/phases/<n>.md` (built / skipped and why / test counts). The director runs the suite before any verdict.

---

## Phase 1 — Project skeleton, cached fetcher, Wikidata disambiguation, search + confirm screens

**Deliverables**
1. Next.js app scaffolded; `npm run dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e` scripts. `.env.example` with `ANTHROPIC_API_KEY`, `WAYBACK_RATE_LIMIT_MS`, `GR_DB_PATH`, `GR_OFFLINE_FIXTURES`.
2. `src/lib/db/`: schema with tables `fetch_cache (url PK, status, body, content_type, fetched_at, source)`, `runs`, `reports`, `signals`; bootstrap at startup; `GR_DB_PATH` honoured; temp DB in tests.
3. `src/lib/fetch/`: `Fetcher` interface; `UndiciFetcher` with descriptive User-Agent, timeout, `Retry-After`-aware retry with backoff (max 3); `CachedFetcher(inner, db, ttl)` that returns cached bodies and records `fetched_at`; `FixtureFetcher(rootDir, map)` resolving URLs to fixture files; `robots.ts` (parse `robots.txt`, `isAllowed(url)`); `RateLimiter(perHostMs)`.
4. `src/lib/wikidata/`: `wbsearchentities` → `wbgetentities` (P856 website, P749 parent, P452 industry, P17 country, P154 logo); `rank.ts` with the brief's rule: exact-name match + has website + instance-of/subclass-of brand/company/organisation ⇒ confident; else candidates (≤3). Recorded fixtures `fixtures/wikidata/*.json` for "patagonia", "acme", and the two other fixture brands.
5. Screens: `/` (single input, Enter submits), `/confirm?q=` (auto-proceeds when confident; otherwise up to 3 cards with Confirm / Not this one; URL-paste fallback when nothing found or all rejected). Proceeding creates a `run` row and redirects to `/analyse/[runId]` (placeholder page for now: shows brand and website).
6. Phone layout (≤ 390 px) and dark mode via `prefers-color-scheme`.

**Acceptance criteria and proofs**

| # | Criterion | Test |
|---|---|---|
| 1.1 | `CachedFetcher` serves a second request for the same URL from SQLite without calling the inner fetcher and keeps the original `fetched_at`. | `tests/unit/fetch/cached-fetcher.test.ts`: inner fetcher call count is 1 after two gets; `fetched_at` equal. |
| 1.2 | `UndiciFetcher` honours `Retry-After` on 429 and gives up after 3 tries. | `tests/unit/fetch/retry.test.ts` with `undici` `MockAgent`: 429 then 200 ⇒ success with one retry; 429×4 ⇒ throws `FetchError` with status 429. |
| 1.3 | `robots.ts` disallows a path blocked by robots.txt and allows otherwise; a disallowed fetch is reported as `skipped: robots.txt disallows <url>`. | `tests/unit/fetch/robots.test.ts`. |
| 1.4 | `RateLimiter` spaces calls to the same host by at least `perHostMs`. | `tests/unit/fetch/rate-limiter.test.ts` with fake timers. |
| 1.5 | Wikidata ranking: "patagonia" fixture ⇒ confident single match with website; "acme" fixture ⇒ no confident match; a fixture with two plausible companies ⇒ candidates array of length ≤ 3, none confident. | `tests/unit/wikidata/rank.test.ts`. |
| 1.6 | E2E: typing "patagonia" + Enter shows the confirm card "Patagonia, Inc. — outdoor apparel, United States, patagonia.com" (or auto-proceeds if confident) and reaches `/analyse/…` showing the brand name. | `tests/e2e/search-confirm.spec.ts`, `GR_OFFLINE_FIXTURES=1`. |
| 1.7 | E2E: typing "acme" shows the URL fallback input; pasting `https://example.com` proceeds to `/analyse/…` with website `example.com`. | same spec file, second test. |
| 1.8 | E2E: the pipeline never starts on an unconfirmed match: clicking "Not this one" on every card shows the URL fallback and no `run` row exists. | same spec, third test, asserts via `/api/runs/count` test-only route or DB read. |
| 1.9 | E2E on phone viewport (iPhone 12 profile): search and confirm have no horizontal overflow. | `tests/e2e/mobile.spec.ts`: `document.documentElement.scrollWidth <= innerWidth`. |

---

## Phase 2 — Page discovery, fetch, visible text, 3 fixture brands

**Deliverables**
1. `src/lib/discover/`: sitemap parse (`/sitemap.xml`, index sitemaps, ≤ 200 URLs) + heuristic paths `/sustainability`, `/impact`, `/responsibility`, `/our-footprint`, `/about`, `/environment`, `/planet`, `/repair`, `/warranty`, `/support` (list in `config/discovery.json`); dedupe; cap 12 pages per brand; respect robots; rate-limit 1 req/s per host.
2. `visible-text.ts`: strip `script/style/nav/footer/header/aside`, collapse whitespace, keep headings and paragraphs; return `{ text, wordCount, links: {href, text}[] }`.
3. Pipeline skeleton `src/lib/pipeline/run.ts` with steps `discover` → `fetchPages`, progress events persisted in `runs.progress` (JSON list of `{step, status: 'running'|'done'|'skipped', reason?}`), consumed by `/analyse/[runId]` via polling (`/api/runs/[id]`). Failed steps show "skipped: reason".
4. `fixtures/brands/<slug>/` for the three brands: `meta.json` (Wikidata entity as recorded, website), `pages/*.html` (≥ 3 pages each, including a sustainability-type page), `fixtures/brands/README.md` listing which files are real captures (with capture date) and which are synthetic.
5. `assertReceipt()` in `signal.ts`.

**Acceptance criteria and proofs**

| # | Criterion | Test |
|---|---|---|
| 2.1 | Discovery on each fixture brand yields ≥ 3 pages including at least one whose path matches the sustainability heuristics, all via `FixtureFetcher`, no network. | `tests/unit/discover/discover.test.ts` (parametrised over the 3 brands). |
| 2.2 | A sitemap index with nested sitemaps is followed; the cap of 12 pages is enforced. | `tests/unit/discover/sitemap.test.ts`. |
| 2.3 | `visibleText` on each fixture sustainability page removes nav/footer text (fixture contains a sentinel string in `<nav>` that must be absent) and reports `wordCount > 100`. | `tests/unit/discover/visible-text.test.ts`. |
| 2.4 | A page disallowed by the fixture robots.txt is skipped with reason text containing "robots.txt", and the run's progress records it. | `tests/unit/pipeline/skip.test.ts`. |
| 2.5 | `assertReceipt` rejects a signal with empty excerpt, missing `source_url` or missing `fetched_at`. | `tests/unit/pipeline/signal.test.ts`. |
| 2.6 | E2E: after confirm, `/analyse/[runId]` lists the steps "Discovering pages" and "Fetching current pages" and both reach "done" offline. | `tests/e2e/analyse-progress.spec.ts`. |

---

## Phase 3 — Claim-language engine (F) with substantiation, evidence-axis rules, methodology doc

**Deliverables**
1. `src/lib/claims/rules/`: one module per rule family, each exporting `{ id, family, description, test(sentence) → match | null }`:
   - `vague` (eco-friendly, natural, green, sustainable (bare), earth-friendly, responsibly made, conscious, clean…),
   - `absolute` (zero impact, 100% sustainable, fully sustainable, completely natural, zero waste (bare)…),
   - `offset` (carbon neutral, climate neutral, net zero (present tense) without a reduction figure within the sentence or the next sentence),
   - `baseline-less comparison` (more sustainable, less plastic, lower impact, better for the planet… without "than", a percentage, or a year in the sentence),
   - `future-only` (will / by 20XX / aim to / committed to … without a progress figure in the sentence or the next sentence).
   Lexicon in `lexicon.ts` (data, not code). Sentence splitter deterministic.
2. `substantiation.ts` (H, same page): for each matched sentence, look in the same sentence and the following two for substantiation markers: number + unit (%, t, tCO2e, kg, kWh), a year, a named standard/certifier (lexicon: GOTS, Fair Trade, B Corp, FSC, bluesign, OEKO-TEX, SBTi, ISO 14001, Cradle to Cradle, EU Ecolabel, Rainforest Alliance, Fairtrade, RWS, GRS, RCS, Climate Neutral Certified, 1% for the Planet, iFixit…), or an anchor whose text matches /report|data|methodology|footnote|study|assessment/. Unsubstantiated ⇒ kind `claim.unsupported`. **Amended by ADR-014 (ruling on C-1):** a year is never a marker on its own (recorded only next to a number + unit in the same sentence, never after by/until/before/no later than/towards); a window sentence that itself matches `future_only` contributes no marker; for a `future_only` hit the matched sentence contributes no number + unit marker; the claim's own trigger spans are blanked before the matched sentence is searched.
3. `engine.ts`: `scanPage(pageText, meta) → Signal[]` with per-1,000-word counts per family in a `ClaimStats` object; signal `excerpt` = the matched sentence (≤ 300 chars); `source_url`/`fetched_at` from the page record; `llm_used: false`.
4. `evidence-rules.ts` (evidence axis, deterministic): `labels_claimed` (certifier lexicon hits ⇒ listed as "label claimed on page; not verified in v1", contributes to "could not check", not to score), `impact_report_link` (anchor text or href matching /report|impact|sustainability/ with `.pdf` or a year; record year if found; > 2 years old ⇒ `evidence.stale_report`; absent ⇒ `evidence.no_report_found`), `absolute_emissions_present` (number followed by tCO2e / tonnes CO2e / t CO2), `supplier_list_present` (anchor text matching /supplier list|factory list|our factories|supply chain map/).
5. `src/lib/copy/wording.ts` + `forbidden.ts` and the forbidden-word test.
6. `docs/METHODOLOGY.md` first version: every rule id, its pattern in words, three example sentences (two hits, one miss), the evidence rules, and a placeholder weights section pointing at `config/weights.json`.

**Acceptance criteria and proofs**

| # | Criterion | Test |
|---|---|---|
| 3.1 | 20 documented sentences (`tests/unit/claims/sentences.ts`: 4 per family, each with expected rule id or `null`) classify exactly as documented. | `tests/unit/claims/rules.test.ts` (table-driven, 20 cases). |
| 3.2 | Substantiation: "Carbon neutral since 2020: we cut scope 1–2 emissions by 41% (see our 2024 report)" is NOT `claim.unsupported`; "We are carbon neutral." alone IS. ADR-014 cases: "We are carbon neutral." followed by "We will be net zero by 2040." and "We aim to cut emissions by 2030." IS unsupported; "Our jackets are eco-friendly. Founded in 1998, we make gear." IS; "We are committed to 100% renewable electricity." IS; "We will be a sustainable company by 2030." gives two unsupported hits; "We are carbon neutral. Our stores are bright. Our emissions were 1,200 tCO2e." is supported. | `tests/unit/claims/substantiation.test.ts`. |
| 3.3 | Per-1,000-word normalisation: the same text duplicated 3× gives the same rate (±0.01). | `tests/unit/claims/engine.test.ts`. |
| 3.4 | On each fixture brand's sustainability page, the engine emits ≥ 1 signal with a receipt (`assertReceipt` passes) and `llm_used === false`. | `tests/unit/claims/fixtures.test.ts`. |
| 3.5 | Evidence rules on fixtures: at least one brand yields `impact_report_link` with a year; at least one yields `labels_claimed`; `labels_claimed` never appears in scored signals. | `tests/unit/claims/evidence-rules.test.ts`. |
| 3.6 | Forbidden words (ADR-008 list) appear nowhere in `src/**/*.{ts,tsx}` string literals or in `docs/METHODOLOGY.md`. | `tests/unit/copy/forbidden.test.ts`. |
| 3.7 | `docs/METHODOLOGY.md` lists every rule id exported by the engine (test reads the doc and the rule registry). | `tests/unit/claims/methodology-sync.test.ts`. |

---

## Phase 4 — Wayback snapshots, diff, retraction detector (A), timeline

**Deliverables**
1. `src/lib/wayback/cdx.ts`: builds `https://web.archive.org/cdx/search/cdx?url=<page>&output=json&filter=statuscode:200&collapse=timestamp:4&from=<year-8>` ; parses JSON rows; picks one snapshot per year (last 8 years); `RateLimiter` at `WAYBACK_RATE_LIMIT_MS` (default 1000, never below 1000 for `web.archive.org`).
2. `snapshot.ts`: fetches `https://web.archive.org/web/<ts>id_/<url>`, runs `visibleText`, caches via `CachedFetcher` (TTL infinite for snapshots).
3. `diff.ts`: sentence-level diff (`diff` package, `diffArrays` on sentences) between consecutive snapshots ⇒ `{ removed: string[], added: string[], from, to }`.
4. `retraction.ts`: for each removed sentence that matches a claim rule (Phase 3 engine) and has no near-equivalent in the later snapshot (normalised string similarity ≥ 0.8 = same claim reworded, not removed), emit `Signal{ axis:'track', kind:'claim.removed', excerpt: removed sentence, source_url: snapshot URL of the earlier snapshot, snapshot_date, fetched_at, llm_used: false }` plus a `DiffCandidate` record for Phase 7 classification. Until Phase 7, classification is `unclassified` and the signal still ships (rule-based); Phase 7 may *downgrade* a candidate to `redesign` (removes it) but never upgrade.
5. Wayback unreachable or 429 ⇒ step `skipped: Wayback unreachable (<status>)`; never partial silence.
6. Snapshot fixtures: `fixtures/brands/<slug>/snapshots/<page-slug>/<YYYYMMDD>.html` for at least two brands; one brand has a page where "carbon neutral" (or similar) is present in 2021 and absent in 2024 while the rest of the page is largely unchanged; another has a redesign (same claim, different markup) that must NOT produce `claim.removed`. `fixtures/brands/<slug>/cdx/<page-slug>.json` holds the hand-built CDX response.
7. `/analyse` step "Pulling <y1>–<y2> snapshots"; report data model gains `timeline: { year, snapshot_url, claims_present: string[], claims_removed: string[] }[]` (UI in Phase 8; a minimal timeline list is rendered on the placeholder report page now).

**Acceptance criteria and proofs**

| # | Criterion | Test |
|---|---|---|
| 4.1 | CDX URL is built exactly as the brief specifies; the JSON row format (header row + data rows) parses into one snapshot per year, newest per year. | `tests/unit/wayback/cdx.test.ts`. |
| 4.2 | Snapshot fetch uses the `id_` flag URL and goes through the cache; two runs hit the inner fetcher once. | `tests/unit/wayback/snapshot.test.ts`. |
| 4.3 | Wayback requests to `web.archive.org` are spaced ≥ 1000 ms even if `WAYBACK_RATE_LIMIT_MS=100`. | `tests/unit/wayback/rate.test.ts` (fake timers). |
| 4.4 | Removed-claim fixture ⇒ exactly one `claim.removed` signal with `snapshot_date` 2021-xx-xx, `source_url` on `web.archive.org`, excerpt containing the removed claim. | `tests/unit/wayback/retraction.test.ts`. |
| 4.5 | Redesign fixture ⇒ zero `claim.removed` signals. | same file. |
| 4.6 | Connection reset / 429 from CDX ⇒ `skipped` with reason containing "Wayback"; the run continues to the next step. | `tests/unit/pipeline/wayback-skip.test.ts` using a fetcher that throws. |
| 4.7 | E2E: for the removed-claim fixture brand, the report placeholder shows a timeline with the year the claim disappeared ("claim removed between 2021 and 2024"). | `tests/e2e/timeline.spec.ts`. |

---

## Phase 5 — Regulator adapters (C: ASA UK, JDP FR) and ownership & repair (E)

**Deliverables**
1. `src/lib/regulators/adapter.ts`: `interface RegulatorAdapter { id; country; search(brand, fetcher) → RulingCandidate[]; fetchRuling(url, fetcher) → Ruling }`, `Ruling { url, title, advertiser, date, outcome: 'upheld'|'not_upheld'|'informally_resolved'|'unknown', excerpt }`.
2. `asa-uk.ts`: `GET https://www.asa.org.uk/search.html?q=<brand>` → parse `/rulings/...` links; ruling page → title, "Advertiser" field, date, outcome from the "Ruling" heading text. `jdp-fr.ts`: `GET https://www.jdp-pub.org/avis/` listing (and `?s=<brand>` if present) → `/avis/<slug>/` links; decision page → title, date, outcome words (`fondée` / `non fondée` / `partiellement fondée` → upheld / not_upheld / partially upheld ⇒ `upheld` with note).
3. `match.ts`: normalise (lowercase, strip legal suffixes Inc/Ltd/SA/GmbH/BV, diacritics, punctuation, trailing geographic/structural qualifiers); `scored` only if one of the ruled entity's names (advertiser split on "t/a") **equals** the normalised brand; a whole-word occurrence of the brand in title or advertiser is `possible` (shown, not scored); anything else is no match. *(Amended at the Phase 5 review, ADR-019: the original "whole word ⇒ scored" contradicted criterion 5.3.)* Entity name verbatim in `entity_name`.
4. Signals: `kind: 'regulator.ruling'`, `weight_hint` higher for `upheld` and for date within 3 years (values from `config/weights.json`), `source_url` = ruling URL, `excerpt` = first 300 chars of the ruling summary, `llm_used: false`.
5. `src/lib/repair/ifixit.ts`: `GET https://www.ifixit.com/api/2.0/wikis/CATEGORY/<brand>` (the brand's device category; its title must equal the brand) and at most `maxDevices` of its device sub-categories: guide titles, repairability score if present. *(Amended at the Phase 5 review, ADR-018: iFixit's robots.txt disallows `/api/2.0/search`; the search endpoint is never requested.)* `brand-pages.ts`: on discovered pages (plus `/repair`, `/warranty`, `/support`): rules for `repair_manual` (anchor/heading /repair guide|service manual|repair manual/), `spare_parts` (/spare parts|replacement parts|parts store/), `warranty_years` (regex `(\d+)[- ]year warranty|warranty of (\d+) years|lifetime warranty`), `repair_program` (/repair program|repair service|we repair|send it in for repair/). Positive findings ⇒ signals lowering the repair sub-score (protective signals, kind `repair.manual_found` etc.); nothing found on a durable-goods brand ⇒ `repair.no_repair_info_found` (receipt = the pages scanned, excerpt = page title list) ; food/non-durable (Wikidata P452 industry in a `non_durable` list in `config/discovery.json`) ⇒ axis marked "not applicable", not scored, listed under could-not-check.
6. Fixtures: `regulators/asa.html` and `regulators/jdp.html` per fixture brand (real captures from the container, which can reach both sites). **If none of the three fixture brands has a real ruling, the builder adds a fourth fixture brand (any sector) with a real recorded ASA or JDP search page and ruling page and logs this in `docs/phases/5.md`; the director accepts this as a fixture brand for DoD item 4.** Also `regulators/asa-ambiguous.html` with partial-name hits for the `possible` path. `repair/ifixit.json` real capture for the electronics brand; repair/warranty HTML pages.
7. `/analyse` steps "Checking ASA (UK) rulings", "Checking JDP (France) decisions", "Checking repair information". Each has a `skipped: reason` path (site unreachable, robots, parse failure).

**Acceptance criteria and proofs**

| # | Criterion | Test |
|---|---|---|
| 5.1 | ASA adapter parses the recorded search page into ≥ 1 ruling URL and the recorded ruling page into `{title, advertiser, date, outcome}` with non-empty values. | `tests/unit/regulators/asa-uk.test.ts`. |
| 5.2 | JDP adapter: same for the recorded listing and decision page; outcome mapping for `fondée`/`non fondée`. | `tests/unit/regulators/jdp-fr.test.ts`. |
| 5.3 | Matching: "Shell" vs advertiser "Shell UK Ltd" ⇒ scored; "Shell" vs "Shell Energy Retail" ⇒ scored only if the whole-word rule says so (document the expected outcome in the test); "Patagonia" vs "Patagonia Provisions Ltd" ⇒ `possible`; "Acme" vs "Acme Widgets" ⇒ `possible`; "Pata" vs "Patagonia" ⇒ no match. | `tests/unit/regulators/match.test.ts`. |
| 5.4 | At least one fixture brand produces a `regulator.ruling` signal with receipt and `entity_name` verbatim; `possible` matches are returned with `scored: false` and never enter `signals[]`. | `tests/unit/regulators/fixtures.test.ts`. |
| 5.5 | Regulator site returning 500 or throwing ⇒ step `skipped: ASA unreachable (500)`; the other adapter still runs. | `tests/unit/pipeline/regulator-skip.test.ts`. |
| 5.6 | iFixit fixture ⇒ `repair.ifixit_*` signal(s) with `source_url` on ifixit.com and excerpt containing the device/guide title. | `tests/unit/repair/ifixit.test.ts`. |
| 5.7 | Brand-page repair rules: warranty regex extracts years from 4 documented phrasings; `lifetime warranty` ⇒ `warranty_years: 'lifetime'`; a page with none ⇒ `repair.no_repair_info_found` with the scanned URLs in the receipt. | `tests/unit/repair/brand-pages.test.ts`. |
| 5.8 | Food fixture brand ⇒ repair axis `not_applicable`, zero repair signals, one could-not-check entry. Electronics fixture ⇒ ≥ 1 receipted repair signal. | `tests/unit/repair/fixtures.test.ts`. |
| 5.9 | E2E: `/analyse` shows the three new steps and each ends in "done" or "skipped: …" offline. | extend `tests/e2e/analyse-progress.spec.ts`. |

---

## Phase 6 — Scorer, confidence, `ai_share` guard, methodology page

**Deliverables**
1. `config/weights.json`: axis weights `{claims:0.25, evidence:0.25, track:0.30, repair:0.20}`, per-kind points, caps per axis, recency/upheld multipliers for rulings, the LLM guard (ADR-007), confidence rules. No numeric literal in `scorer.ts` other than 0, 1, 100.
2. `scorer.ts`: per axis sub-score 0–100 from signal points (capped), weighted sum, label `Low / Moderate / High signals` (thresholds in weights.json), `"Based on N verified signals from M sources."` where M = distinct `source_url` hosts. Missing axis (no signals and not `not_applicable`) ⇒ contributes 0 and lowers confidence; `not_applicable` axis ⇒ its weight is redistributed proportionally (documented) and confidence unaffected.
3. `confidence.ts`: confidence 0–100 = share of axis weight that had at least one step `done` (not skipped) with data; shown as "Score 62, confidence 40%".
4. `ai-share.ts`: ADR-007 definition and guard; output `ai_share` (0–1) and `llm_signal_ids[]`.
5. `/methodology` static page generated from `weights.json` + METHODOLOGY.md content (every weight shown; no hand-copied numbers).
6. Report JSON model `ReportV1` (zod): `{ brand, website, score, label, confidence, ai_share, axes: {id, weight, subscore, signals[]}[], timeline[], could_not_check[], skipped[], generated_at, sources_count, signals_count }`; `reports` table stores it.

**Acceptance criteria and proofs**

| # | Criterion | Test |
|---|---|---|
| 6.1 | Weighted sum: hand-computed example with sub-scores (40, 20, 80, 10) ⇒ 10+5+24+2 = 41. | `tests/unit/score/scorer.test.ts`. |
| 6.2 | Missing data never increases the score: removing any signal from a set never raises `score` (property test over 500 random signal sets). | `tests/unit/score/monotonic.test.ts`. |
| 6.3 | `ai_share ≤ 0.5` for every input: property test over 1,000 random signal sets including all-`llm_used` sets and empty non-LLM sets; also a hand case where LLM points would be 90% ⇒ guard scales to exactly 0.5. | `tests/unit/score/ai-share.test.ts` (the DoD guard test). |
| 6.4 | A signal failing `assertReceipt` is rejected by the scorer (throws in dev, filtered + logged in prod mode); the test asserts it is absent from `ReportV1.axes[].signals`. | `tests/unit/score/receipts.test.ts`. |
| 6.5 | `scorer.ts` and `ai-share.ts` contain no numeric literals other than 0, 1, 100 (regex scan of the source). | `tests/unit/score/no-magic-numbers.test.ts`. |
| 6.6 | Each fixture brand ⇒ a valid `ReportV1` (zod parse) with `ai_share` reported, `confidence` in 0–100, and `could_not_check` non-empty. | `tests/unit/score/fixtures.test.ts`. |
| 6.7 | `/methodology` renders every key of `weights.json` axes with its percentage. | `tests/e2e/methodology.spec.ts`. |
| 6.8 | `docs/METHODOLOGY.md` weights section equals `weights.json` (test parses both). | `tests/unit/score/methodology-sync.test.ts`. |

---

## Phase 7 — LLM layer: claim extraction, diff classification, summary (mocked; real client wired)

**Deliverables**
1. `src/lib/llm/client.ts`: `interface LLMClient { call<T>(name, input, schema: ZodSchema<T>) → T }`. `anthropic.ts`: Anthropic SDK, tool-use with the zod schema converted to JSON schema, temperature 0, system prompt that forbids referencing anything outside the provided text, model id from `config/llm.json`. Loaded only when `ANTHROPIC_API_KEY` is set and `GR_OFFLINE_FIXTURES` is not; otherwise `MockLLM`.
2. `mock.ts`: fixtures at `fixtures/llm/<name>-<sha1(input).slice(0,12)>.json`; missing ⇒ empty valid result; `GR_RECORD_LLM=1` with a real key writes fixtures.
3. `extract.ts`: input = page visible text + allowed URL list; output schema `{ claims: { sentence, kind_hint }[] }`; each returned sentence must be a verbatim substring of the input (else dropped); the rule engine (Phase 3) re-scans accepted sentences; signals from this path keep `llm_used: true` only if the rule engine would not have found them alone (otherwise the deterministic signal wins and `llm_used: false`).
4. `classify-diff.ts`: input = removed sentence + context before/after in both snapshots; output `{ classification: 'claim_removed'|'redesign'|'moved'|'unsure' }`; `redesign`/`moved` ⇒ Phase 4 candidate dropped; `claim_removed` ⇒ signal kept with `llm_used: true`; `unsure` ⇒ kept, `llm_used: true`, weight_hint halved (value in weights.json).
5. `summary.ts`: input = `ReportV1` without the summary + allowed URL list; output `{ summary: string, cited_urls: string[] }`; every URL in the text or `cited_urls` must be in the allowed list (else the summary is rejected and the UI shows "Summary unavailable"); summary passes the forbidden-word filter; ≤ 120 words.
6. Pipeline wiring: extraction after fetch, classification after retraction, summary after scoring. Each with `skipped: LLM unavailable` path. `ReportV1.summary?` and `llm_calls[]` log `{name, used_fixture: bool}`.
7. Recorded fixtures for all three brands so the offline flow exercises all three calls.
8. (ADR-017) Live page as the final element of the sequence: for every page fetched live that has ≥ 1 archived snapshot, `detectRetractions` runs over `[...snapshots, livePage]` where the live entry has `year = current year`, `snapshot_url = the page URL` and is marked `live: true` in the timeline. A claim present in the newest snapshot and absent from the live page (same 0.8 similarity rule) ⇒ `claim.removed` with label "claim removed between <year> and the current page", `source_url` = the newest snapshot's `id_` URL, `snapshot_date` = its capture date, plus a `DiffCandidate` for `classify-diff`. Robots-disallowed pages (no live text) are unchanged.

**Acceptance criteria and proofs**

| # | Criterion | Test |
|---|---|---|
| 7.1 | Schema validation: an LLM output with an extra field, wrong type, or a non-substring sentence is dropped item-wise; a fully invalid payload yields an empty result and a `skipped` entry, never a throw. | `tests/unit/llm/schemas.test.ts`. |
| 7.2 | `extract` never introduces a URL: output signals only carry `source_url` of the page they came from. | `tests/unit/llm/extract.test.ts`. |
| 7.3 | `classify-diff`: mock returning `redesign` removes the Phase 4 candidate; `claim_removed` keeps it with `llm_used: true`; `unsure` halves `weight_hint`. | `tests/unit/llm/classify-diff.test.ts`. |
| 7.4 | Summary citing a URL not in the fetched list is rejected; a summary with only fetched URLs passes; a summary containing a forbidden word is rejected. | `tests/unit/llm/summary.test.ts`. |
| 7.5 | With `MockLLM` and no fixture file, every call returns an empty valid result and the pipeline completes. | `tests/unit/llm/mock.test.ts`. |
| 7.6 | `ai_share` on the three real fixture brands plus the fictional removed-claim brand (Northwind, ADR-011), with LLM fixtures active, is ≤ 0.5 for all and > 0 for Northwind (ADR-017). | `tests/unit/llm/ai-share-fixtures.test.ts`. |
| 7.7 | Anthropic client construction: with no key ⇒ `MockLLM`; with key and `GR_OFFLINE_FIXTURES=1` ⇒ `MockLLM`; with key only ⇒ `AnthropicLLM` (constructor only, no network). | `tests/unit/llm/client-select.test.ts`. |
| 7.8 | (ADR-017) A fixture page whose newest snapshot carries a claim that the live page no longer has ⇒ exactly one `claim.removed` labelled "claim removed between <year> and the current page", `source_url` = the newest snapshot's `id_` URL; the same claim still on the live page ⇒ none; a robots-disallowed page ⇒ no live comparison. | `tests/unit/wayback/live-diff.test.ts` (Northwind: add the claim back to its 2025 snapshot and keep it off the live `/our-footprint/`, or a dedicated case). |

---

## Phase 8 — Report UI, JSON export, shareable cached report, accessibility

**Deliverables**
1. `/report/[id]`: headline (score, label, "Based on N verified signals from M sources.", confidence, "AI contributed to X% of this score"); four axes with sub-score and receipts list (each line: label, excerpt, source URL link, fetch date, snapshot date if any, `entity_name` if any, "AI-assisted" badge when `llm_used`); timeline (years, claims present/removed); "What we could not check"; skipped steps; summary (or "Summary unavailable"); link to `/methodology`; "Download evidence (JSON)" (`/api/reports/[id].json`); share link = the page URL.
2. Serving from cache: `/report/[id]` reads the stored `ReportV1`; a new search for a brand with a report younger than `GR_REPORT_TTL_HOURS` (default 168) redirects to the existing report without running the pipeline (a "Re-run" link forces a new run).
3. Phone + desktop CSS, dark mode, no animations, system font stack. Focus styles, landmarks, headings order, link text, contrast ≥ 4.5:1.
4. Lighthouse accessibility run script `npm run lighthouse` (uses Playwright's Chromium via `chrome-launcher` `chromePath`). If Lighthouse cannot run in the container, fallback `@axe-core/playwright` with zero serious/critical violations, and the fallback is logged in `docs/phases/8.md` and `docs/LIMITATIONS.md`.

**Acceptance criteria and proofs**

| # | Criterion | Test |
|---|---|---|
| 8.1 | E2E full flow offline for each fixture brand: search → confirm → analyse → report; report shows score, label, the "Based on N verified signals from M sources." sentence with N,M > 0, and the AI share line. | `tests/e2e/full-flow.spec.ts` (3 brands). |
| 8.2 | Every rendered signal row has a link with `href` starting `http`, a fetch date, and a non-empty excerpt (DOM assertion over all `[data-signal]` rows). | `tests/e2e/receipts.spec.ts`. |
| 8.3 | "What we could not check" lists ≥ 1 item for each fixture brand; skipped steps are rendered. | same spec. |
| 8.4 | JSON export downloads and zod-parses as `ReportV1`; its `signals` equal the rendered rows count. | `tests/e2e/export.spec.ts`. |
| 8.5 | Second visit to `/report/[id]` is served from cache: server timing header `x-gr-served-from: cache` and response time < 1000 ms measured in the test; searching the same brand again redirects to the same report id without new progress steps. | `tests/e2e/cache.spec.ts` + `tests/unit/db/report-cache.test.ts` (`getReport(id)` < 1000 ms, 100 iterations average). |
| 8.6 | Phone viewport: no horizontal scroll on report; all axes visible; desktop viewport snapshot has four axis sections. | `tests/e2e/mobile.spec.ts` extended. |
| 8.7 | Lighthouse accessibility ≥ 90 on `/`, `/confirm`, `/report/[id]` (or documented axe fallback: 0 serious/critical). | `npm run lighthouse` output saved to `docs/phases/8-lighthouse.json`; `tests/e2e/a11y.spec.ts` for the axe path. |
| 8.8 | Forbidden-word test extended to rendered HTML of the three fixture reports. | `tests/e2e/wording.spec.ts`. |

---

## Phase 9 — README, LIMITATIONS, final review

**Deliverables (builder)**
1. `README.md`: what it is, setup (`npm install`, `.env`, `npm run dev`), running tests (`npm test`, `npm run test:e2e`, `npm run lighthouse`), offline fixture mode, the exact commands, limits, legal wording statement ("signals, not verdicts"), where the methodology lives, how to add a regulator adapter.
2. `docs/LIMITATIONS.md`: build-env facts (Wayback unreachable, Wikidata 429s, no API key, B Corp blocked), coverage limits (two regulator countries, repair axis durable goods only, same-page substantiation only, no JS rendering), what "could not check" means, the deferred DoD item(s).
3. If `ANTHROPIC_API_KEY` is present at this point: run one real brand end to end (`npm run e2e:real -- <brand>`), save the report id and timings in `docs/phases/9.md`; otherwise write "deferred: no API key".
4. Sync check: every doc claim about behaviour maps to a test or a file; `docs/METHODOLOGY.md` matches `weights.json` (test 6.8 still green).

**Deliverables (director)**
5. `docs/FINAL-REVIEW.md`: one row per DoD item with the command/test that proves it and its observed result.

**Acceptance criteria and proofs**

| # | Criterion | Test |
|---|---|---|
| 9.1 | Fresh clone: `npm ci && npm run build` succeeds; `npm run dev` serves `/` with HTTP 200 within 30 s with no error output. | `scripts/smoke.sh` run by the director. |
| 9.2 | `npm test` and `npm run test:e2e` green with `GR_OFFLINE_FIXTURES=1`. | director runs both. |
| 9.3 | README commands run as written (director executes each). | manual by director, recorded in FINAL-REVIEW. |
| 9.4 | LIMITATIONS lists every `skipped` reason string that exists in `src/` (test extracts the reason templates from `wording.ts`). | `tests/unit/docs/limitations-sync.test.ts`. |

---

## Definition of Done mapping (brief Section 10)

| DoD item | Proved by |
|---|---|
| `npm install && npm run dev` starts with no errors; `npm test` and Playwright pass | 9.1, 9.2 |
| Three screens work on phone and desktop | 1.6, 1.7, 1.9, 8.1, 8.6 |
| One real brand end to end with a key; served from cache < 1 s afterwards | Phase 9 item 3 (deferred: no API key, if absent); cache timing 8.5 regardless |
| Each chosen differentiator produces ≥ 1 receipted signal on a fixture brand | A: 4.4; C: 5.4; E: 5.6 / 5.8; F baseline: 3.4 |
| `ai_share ≤ 0.5` enforced by a test and shown in the UI | 6.3, 7.6; UI 8.1 |
| Every signal has URL, fetch date, excerpt; could-not-check populated honestly | 2.5, 6.4, 8.2, 8.3 |
| METHODOLOGY, LIMITATIONS, DECISIONS, README exist and match the code | 3.7, 6.8, 9.4, FINAL-REVIEW |

## Hard limits (brief Section 0.4) as applied to this plan

- Max 3 rework rounds per phase; max 2 re-plans in the run. On overflow the director cuts scope in this file and logs an ADR.
- Pre-authorised scope cuts if a phase runs out of budget, in this order: Phase 5 JDP adapter (keep ASA; log), Phase 8 Lighthouse (axe fallback), Phase 7 summary (show "Summary unavailable"), Phase 2 sitemap parsing (heuristic paths only). F, A, C-ASA, E-iFixit, scorer and the `ai_share` guard are never cut.
- No new dependencies that need accounts or paid services. No network in tests.
