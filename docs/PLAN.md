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

---

# v1.1 — Trusted external sources and validation (Phases 10–15)

Written by the director 2026-10-21 after v1 merged (PR #1, `docs/FINAL-REVIEW.md`). Source triage, probes and licence notes are in `docs/SOURCES.md`; decisions in ADR-024 to ADR-031. Native `director`/`builder` agents are loaded for this run (ADR-024). Hard-limit counters restart for v1.1: max 3 rework rounds per phase, max 2 re-plans.

## v1.1 conventions (in addition to the v1 conventions above)

- **Order is binding:** Phase 10 (validation harness) before any new source; Phase 14 (claims formula) only after Phases 10–13, so the change is measured on the same harness before and after.
- **Ground-truth isolation.** `fixtures/validation/ground-truth.json` is read only by `src/lib/validation/*`, `scripts/validate.ts` and tests. Nothing under `src/lib/pipeline`, `src/lib/score`, `src/lib/regulators`, `src/lib/repair`, `src/lib/registries` or `src/app` may import `src/lib/validation` or read the file (criterion 10.4). `docs/METHODOLOGY.md` gains a section saying labels are evaluation-only.
- **New signals are deterministic.** Every signal from Phases 11–13 has `llm_used: false`; the 50% guard (6.3, 7.6) stays green with no change. New kinds and points live only in `config/weights.json` (version bumped to 2 in Phase 11; METHODOLOGY sync test 6.8 updated with it). `confidence.axisSteps` gains the new step ids.
- **Fixtures (ADR-011 unchanged):** real recorded responses (dataset rows, export rows, document pages) for real brands, saved by a recorder script with capture date; synthetic cases only for the fictional `.example` brands. New fixture roots: `fixtures/sources/sbti/`, `fixtures/sources/fr-repair/`, `fixtures/sources/sabin/`, `fixtures/validation/`.
- **Wording (ADR-008):** every new label is a template in `src/lib/copy/wording.ts`; the forbidden-word tests (3.6, 8.8) run unchanged. A litigation case is never called a ruling; an SBTi removal is "commitment removed (as published by SBTi)", not a verdict about the brand.
- **Layout additions:**
  ```
  src/lib/validation/       ground-truth.ts (zod schema + loader), stats.ts (AUC, mean difference), harness.ts (run per brand, collect), report.ts (RESULTS.md + JSON)
  src/lib/registries/       sbti.ts (xlsx reader + lookup), fr-repair.ts (data.gouv.fr API + CSV), sabin.ts (document-page parser + discovery)
  src/lib/pipeline/steps/   sbti.ts, fr-repair.ts, sabin.ts
  scripts/validate.ts       npm run validate
  scripts/record-registries.ts  npm run record:registries (SBTi export, FR datasets, Sabin pages for the fixture brands)
  docs/validation/          RESULTS.md (latest) + results-<YYYY-MM-DD>-<mode>.json (committed), one file per run
  ```
- **Every phase:** `npm run lint && npm run typecheck && npm test && npm run test:e2e` green offline; commit `phase <n>: <title>`; push; `docs/phases/<n>.md`.

---

## Phase 10 — Validation set and harness

**Deliverables**
1. `fixtures/validation/ground-truth.json` per the schema and rules in `docs/SOURCES.md` ("how an entry is made"): target 20 `flagged` and 20 `well_rated` (minimum 15 each), `contested` entries allowed, every citation with `url`, `date`, `why`, `verified_from_container`. Citations recorded by fetching (the recorder stores the cited page under `fixtures/validation/citations/<slug>-<n>.html` with the capture date; NewClimate and B Corp citations may be `verified_from_container: false`).
2. `src/lib/validation/ground-truth.ts` (zod schema, loader, `label_use === "evaluation_only"` asserted), `stats.ts` (Mann–Whitney AUC with tie handling, mean and median difference, per-axis AUC, Spearman rank correlation between `words_scanned` and score and between claim-sentence count and score: the "saying less scores better" diagnostic), `harness.ts` (runs the pipeline for one brand through the existing `startRun` path with injected services; collects `ReportV1`, step statuses, skipped reasons), `report.ts` (writes `docs/validation/results-<date>-<mode>.json` and regenerates `docs/validation/RESULTS.md`).
3. `scripts/validate.ts` → `npm run validate -- [--mode offline|live] [--brands a,b] [--out docs/validation]`. Offline mode uses `GR_OFFLINE_FIXTURES=1` services and runs only the ground-truth brands that have a fixture; live mode runs every brand through the live services with the v1 rate limits and caches, continues past failures, and records per-brand coverage (steps done / skipped and why). Both modes label the results file with `mode`, `n_flagged`, `n_well_rated`, `n_ran`, `n_failed`, commit hash, `weights.version`, and the sentence "Partial run: N of M brands produced a report" when applicable.
4. Offline fixture subset: real captures (`npm run record:brand`, `record:sources`) for at least 2 `flagged` and 2 `well_rated` ground-truth brands in addition to the v1 fixture brands (Oatly already qualifies as flagged via its recorded ASA ruling). The fictional brands are never in the ground truth.
5. A live run from the build container, recorded as `docs/validation/results-<date>-live.json` and summarised in `RESULTS.md`, honestly labelled partial where Wayback or a brand site was unreachable. If the live run cannot produce at least 5 reports per group, `RESULTS.md` says so and the offline result stands as the only separation figure.
6. `docs/METHODOLOGY.md` Section 13 "Validation (evaluation only)": what the ground truth is, that labels never enter the score, what "well-rated" means (no credible flag found + two positive markers; weak by construction), how AUC is computed, and where results live.

**Acceptance criteria and proofs**

| # | Criterion | Test |
|---|---|---|
| 10.1 | `ground-truth.json` parses; every entry has ≥ 1 citation with `url` (http), `date` (ISO), non-empty `why`; `flagged` ≥ 15 and `well_rated` ≥ 15; no slug appears twice; no `.example` brand; `verified_from_container: false` only on `newclimate` or `bcorp` citations. | `tests/unit/validation/ground-truth.test.ts`. |
| 10.2 | `auc()` on hand cases: perfect separation ⇒ 1.0; reversed ⇒ 0.0; identical scores ⇒ 0.5; ties handled (half credit); `meanDifference`, `spearman` on documented inputs. | `tests/unit/validation/stats.test.ts`. |
| 10.3 | Offline harness runs end to end on the fixture subset (no network), writes a results JSON that parses against the results schema, and `RESULTS.md` contains the AUC line, the n per group, the coverage table and the partial-run sentence when n < entries. | `tests/unit/validation/harness.test.ts` (temp output dir). |
| 10.4 | Isolation: no file under `src/` other than `src/lib/validation/**` imports `validation/ground-truth` or reads `fixtures/validation`; `src/lib/validation/**` is imported only from `scripts/validate.ts` and `tests/**` (import-graph scan). | `tests/unit/validation/isolation.test.ts`. |
| 10.5 | A brand whose run throws is recorded as `failed` with the reason and the harness continues; the summary counts it in `n_failed`, never in the AUC sample. | `tests/unit/validation/harness.test.ts`, second case with a throwing fetcher. |
| 10.6 | `RESULTS.md` reports the leakage line: how many `flagged` entries are flagged **only** by sources the pipeline itself queries (ASA, JDP, and from Phase 11–13 SBTi, Sabin), so the reader can discount that overlap. | `tests/unit/validation/report.test.ts` (string present, number equals a hand-computed value on a 4-entry fixture). |
| 10.7 | `npm run validate -- --mode offline` exits 0 in CI and commits nothing outside `docs/validation/`. | director runs it; `docs/validation/results-<date>-offline.json` exists in the phase commit. |
| 10.8 | METHODOLOGY Section 13 exists and contains the sentence "Ground-truth labels are used for evaluation only and never enter the score." | `tests/unit/docs/methodology-validation.test.ts`. |

---

## Phase 11 — SBTi commitment status (track-record axis)

**Deliverables**
1. `src/lib/registries/sbti.ts`: downloads `https://files.sciencebasedtargets.org/production/files/companies-excel.xlsx` through `CachedFetcher` (TTL `config/registries.json` `sbti.ttlHours`, default 168; binary bodies supported by the fetcher and the cache), parses with `exceljs` (new dependency, MIT; ADR-026) into rows `{ company_name, isin, lei, location, sector, near_term_status, near_term_target_year, net_zero_status, net_zero_year, status_reason, date_updated (ISO from the Excel serial), full_target_language }`; `lookup(brand, rows)` using the ADR-019 normalisation: **scored** only when `company_name` equals the brand after normalisation (legal suffixes, qualifiers); whole-word ⇒ `possible` (could-not-check, entity verbatim). Also matches when the Wikidata entity's ISIN (P946) or LEI (P1278) equals the row's, if present.
2. Signals (`llm_used: false`, receipt = export URL, fetch date, excerpt = the row's name, both statuses, `status_reason`, `date_updated`, plus the attribution line of SOURCES.md): `sbti.commitment_removed` when either status is "Commitment Removed" and `status_reason` is not in `config/registries.json` `sbti.neutralReasons` (`["Target set at parent company level", "Company change"]`, which yield `sbti.status_note`, 0 points, listed); `sbti.targets_validated` (0 points) when near-term is "Validated Targets"; `sbti.commitment_pending` (0 points) for "Commitment to Set Targets". `weight_hint`: removal within `recentYears` (reuse `regulatorRuling.recentYears`) × `recentMultiplier`; an "Expired commitment" reason × `sbti.expiredMultiplier` (default 1; the director sets the value in the review, not the builder).
3. `config/weights.json` version 2: `track["sbti.commitment_removed"]` (director's value: 15), `sbti.targets_validated: 0`, `sbti.commitment_pending: 0`, `sbti.status_note: 0`; `confidence.axisSteps.track` gains `"sbti"`. METHODOLOGY Section 7 and 9b updated; test 6.8 green.
4. Step `sbti` ("Checking SBTi target status") with `skipped: SBTi export unreachable (<status>)` and `skipped: SBTi export could not be parsed` paths; never partial silence; the step runs after the regulator steps.
5. `scripts/record-registries.ts` (`npm run record:registries -- sbti`): saves the export as `fixtures/sources/sbti/companies-<date>.xlsx` **trimmed to the rows of the fixture and ground-truth brands plus 50 random rows** (the full 2.3 MB file is not committed; the trimming script records the full file's `last-modified`, row count and sha256 in `fixtures/sources/sbti/README.md`). Offline mode serves the trimmed file.
6. Report UI: the signal renders in the track axis like a ruling, with the attribution line; `possible` matches under "What we could not check".

**Acceptance criteria and proofs**

| # | Criterion | Test |
|---|---|---|
| 11.1 | The recorded export parses into rows with the 12 listed fields; `date_updated` converts from the Excel serial to an ISO date; a row count equal to the README's trimmed count. | `tests/unit/registries/sbti-parse.test.ts`. |
| 11.2 | Lookup: a fixture brand with "Commitment Removed" ⇒ exactly one `sbti.commitment_removed` with receipt and `entity_name` verbatim; a brand with "Validated Targets" ⇒ `sbti.targets_validated` with 0 points in the scorer; "Target set at parent company level" ⇒ `sbti.status_note`, 0 points; a whole-word-only name ⇒ `possible`, not a signal; ISIN match scores even when the name differs. | `tests/unit/registries/sbti-lookup.test.ts`. |
| 11.3 | Export unreachable (5xx / throw) ⇒ `skipped: SBTi export unreachable (…)`; a corrupt xlsx ⇒ `skipped: SBTi export could not be parsed`; the next step runs. | `tests/unit/pipeline/sbti-skip.test.ts`. |
| 11.4 | Points come only from `config/weights.json`; `scorer.ts` still has no numeric literals (6.5); removing the SBTi signal never raises the score (6.2 re-run); `ai_share` unchanged (7.6). | existing 6.2, 6.5, 7.6 plus `tests/unit/score/weights-v2.test.ts` (new kinds present, version 2). |
| 11.5 | Receipt excerpt contains the attribution line and the `status_reason`; forbidden-word test green on the new wording. | `tests/unit/registries/sbti-wording.test.ts` + 3.6. |
| 11.6 | Binary bodies round-trip through `CachedFetcher` (second fetch served from SQLite, bytes identical). | `tests/unit/fetch/cached-binary.test.ts`. |
| 11.7 | E2E: `/analyse` shows "Checking SBTi target status" ending in done or skipped; the fixture brand's report shows the SBTi signal row with a link to the export URL. | extend `tests/e2e/analyse-progress.spec.ts`, `tests/e2e/receipts.spec.ts`. |
| 11.8 | Validation before/after: `npm run validate -- --mode offline` re-run; `RESULTS.md` keeps the Phase 10 figure and adds the Phase 11 figure. | director compares the two committed results files. |

---

## Phase 12 — French repairability index (repair axis)

**Deliverables**
1. `src/lib/registries/fr-repair.ts`: `GET https://www.data.gouv.fr/api/1/datasets/?q=indice%20de%20reparabilite&page_size=100` (+ pages), cached (TTL `frRepair.ttlHours`), `Retry-After`/backoff for the resets seen from this egress (v1 retry policy); candidate datasets = those whose `organization.name` (or owner) equals the brand after normalisation **or** whose title contains the brand as a whole word (then verified by the CSV rows' `nom_metteur_sur_le_marche`). For each candidate: licence gate (`config/repair.json` `frIndex.openLicences`, see SOURCES.md); open ⇒ fetch the newest CSV resource (the resource URL through the robots guard; when robots.txt disallows it, the data.gouv.fr tabular-API CSV export, through the same guard), parse with the Etalab schema field names (`;` or `,` delimiter detection, UTF-8 with/without BOM), keep the newest `date_calcul` row per `id_modele`; not open ⇒ could-not-check line with the dataset URL and licence id, no excerpt.
2. Signals (`llm_used: false`, receipt = CSV resource URL, fetch date, excerpt = `nom_modele`, `categorie_produit`, `note_ir`, `date_calcul`, licence id, dataset page URL): `repair.fr_index_found` (0 points; excerpt lists up to 5 models with their scores) when rows match; `repair.fr_index_low` (risk points) when the mean `note_ir` of the kept rows is below `frIndex.lowThreshold` (director's value: 5.0, the index is 0–10). Both replace `repair.no_repair_info_found` (ADR-020). Non-durable brands: axis stays not applicable, the step is skipped with the existing reason.
3. `config/weights.json`: `repair["repair.fr_index_found"]: 0`, `repair["repair.fr_index_low"]` (director's value: 30); `confidence.axisSteps.repair` gains `"fr-repair"`. `config/repair.json` gains `frIndex: { apiUrl, pageSize, maxPages, ttlHours, openLicences, lowThreshold, maxModelsInExcerpt }`.
4. Step `fr-repair` ("Checking the French repairability index") with `skipped: data.gouv.fr unreachable (<cause>)`, `skipped: repairability dataset could not be parsed (<url>)`.
5. Recorder: `npm run record:registries -- fr-repair` saves the API pages and the CSVs for the fixture and ground-truth brands under `fixtures/sources/fr-repair/` with a manifest. Fairphone (Licence Ouverte 2.0, `note_ir` 9.3) is the open-licence case; a `notspecified` dataset of another real brand is the gated case.
6. METHODOLOGY Section 10 gains the index (what it is, the licence gate, the threshold, the mandatory-disclosure basis) and LIMITATIONS the coverage note (French market only; most datasets carry no licence and are therefore only pointed to).

**Acceptance criteria and proofs**

| # | Criterion | Test |
|---|---|---|
| 12.1 | API fixture pages parse into datasets with slug, organisation, licence, resources; pagination follows `next_page` up to `maxPages`. | `tests/unit/registries/fr-repair-api.test.ts`. |
| 12.2 | CSV parsing: Fairphone fixture ⇒ 6 rows, newest per `id_modele`, `note_ir` 9.3, `date_calcul` 2025-06-25; a `;`-delimited and a BOM-prefixed variant parse identically. | `tests/unit/registries/fr-repair-csv.test.ts`. |
| 12.3 | Licence gate: lov2 dataset ⇒ `repair.fr_index_found` with receipt; `notspecified` dataset ⇒ no signal, one could-not-check entry containing the dataset URL and "licence not specified"; the CSV of a gated dataset is never fetched (fetcher call log). | `tests/unit/registries/fr-repair-gate.test.ts`. |
| 12.4 | Threshold: a synthetic fictional-brand CSV (`.example`) with mean 3.2 ⇒ `repair.fr_index_low`; mean 5.0 ⇒ `fr_index_found` only; the threshold value is read from config (test changes it and observes). | `tests/unit/registries/fr-repair-threshold.test.ts`. |
| 12.5 | Matching: organisation "ELECTROLUX FRANCE" vs brand "Electrolux" ⇒ scored (qualifier "france" stripped by ADR-019 lists); "Robert Bosch France SAS" vs "Bosch" ⇒ `possible`, not scored; "Fairphone" vs "Fairphone" ⇒ scored. | `tests/unit/registries/fr-repair-match.test.ts`. |
| 12.6 | Connection reset on the API ⇒ retried per the v1 policy, then `skipped: data.gouv.fr unreachable (…)`; the repair step still runs. | `tests/unit/pipeline/fr-repair-skip.test.ts`. |
| 12.7 | Fairphone fixture report: repair axis lists `repair.fr_index_found` with the data.gouv.fr receipt; Oatly (food) ⇒ step skipped as not applicable; 6.2 / 6.5 / 7.6 green. | `tests/unit/repair/fixtures.test.ts` extended; existing score tests. |
| 12.8 | E2E: progress step shown; receipt row links to `static.data.gouv.fr`, `www.data.gouv.fr` or `tabular-api.data.gouv.fr`. | extend `tests/e2e/analyse-progress.spec.ts`, `tests/e2e/receipts.spec.ts`. |
| 12.9 | Validation re-run (offline) committed; RESULTS.md adds the Phase 12 figure. | director compares. |

---

## Phase 13 — Sabin Center climate litigation adapter (track-record axis)

**Deliverables**
1. `src/lib/registries/sabin.ts` implementing the Phase 5 `RegulatorAdapter` interface shape, under a distinct `CaseAdapter` type: `discover(brand, entity, fetcher) → CaseCandidate[]` and `fetchCase(url, fetcher) → Case { url, title, summary, filed_year, status, last_event, geographies, parties_from_title }`. Parsing reads the server-rendered `__NEXT_DATA__` of `/document/<slug>` (`family.title`, `summary`, `published_date`, `events`, `metadata`, `geographies`), never the private API, never `/_search` (ADR-028; a test pins that every requested URL is under `/document/` or `/geographies/`).
2. Discovery = (a) the brand's country page `/geographies/<slug>` (slug from Wikidata P17 label via `config/registries.json` `sabin.countrySlugs`) and, when the brand's country is not the US, also `/geographies/united-states-of-america`; only the families server-rendered on those pages (4 each, as observed); (b) the recorded seed index `fixtures/sources/sabin/index.json` (`{ url, recorded_at, recorded_from }` entries saved by the recorder from pages the builder reached on the site); each entry is re-fetched live and matched on its parsed title, never trusted. Could-not-check always states the coverage: "litigation coverage: only the newest cases listed for <country> and a recorded index of <n> cases; the database's search is not available to automated clients".
3. Matching: party names = the title split on " v. ", " v ", " vs ", " vs. ", " et al.", "," and " and "; **scored** only when a party equals the brand after the ADR-019 normalisation; whole-word ⇒ `possible`, shown with the title verbatim, never a signal; else none.
4. Signals (`llm_used: false`, receipt = document URL, fetch date, excerpt = title + first 300 chars of the summary + status/last event as published, plus the attribution line): kind `litigation.case`; `weight_hint` from `config/weights.json` `litigation`: `statusMultipliers` keyed by a configurable keyword list over `status`/`last_event` (`dismissed|withdrawn|struck out` ⇒ 0; `pending|filed|ongoing` ⇒ 1; `decided|judgment` ⇒ 1; unknown ⇒ 1) and the `recentYears` multiplier. Points (director's value) `litigation.case: 10` — strictly below `regulator.ruling: 25` because a filed case is not a finding. Label template: "case found naming <party verbatim> (<status as published>, filed <year>) — a filed case is not a ruling".
5. Step `sabin` ("Checking the climate litigation database") with `skipped: climatecasechart.com unreachable (<status>)`, `skipped: case page could not be parsed (<url>)`; runs after `jdp-fr`. `confidence.axisSteps.track` gains `"sabin"`.
6. Recorder `npm run record:registries -- sabin`: geography pages for the fixture brands' countries and the US, plus the seed-index document pages (real captures with capture date), under `fixtures/sources/sabin/`. At least one real case page whose title names a real ground-truth brand exactly (candidate seen today: the TotalEnergies greenwashing case family on the France geography listing — verify on the document page) so criterion 13.3 is met by a real capture; the fictional brands cover the `possible`/dismissed paths with synthetic `.example` pages.
7. METHODOLOGY Section 9c (litigation: what counts, wording, weight below rulings, coverage limit), LIMITATIONS (discovery limit, download-by-form not used, terms page unreadable from the container).

**Acceptance criteria and proofs**

| # | Criterion | Test |
|---|---|---|
| 13.1 | Document-page parser on the recorded page ⇒ non-empty `title`, `summary`, `filed_year`, `status` (or "unknown"), ≥ 1 geography. | `tests/unit/registries/sabin-parse.test.ts`. |
| 13.2 | Geography-page parser ⇒ the 4 families with slug and title; the document URL is built as `/document/<family_slug>`. | `tests/unit/registries/sabin-geo.test.ts`. |
| 13.3 | At least one real ground-truth brand yields a scored `litigation.case` with receipt, `entity_name` = the party verbatim, label containing "a filed case is not a ruling"; a `possible` title never enters `signals[]`. | `tests/unit/registries/sabin-fixtures.test.ts`. |
| 13.4 | Status multipliers: "Dismissed" ⇒ `weight_hint` 0 (listed, 0 points); "Pending" ⇒ 1; keywords read from config. | `tests/unit/registries/sabin-weight.test.ts`. |
| 13.5 | Every URL the adapter requests is under `/document/` or `/geographies/` on `www.climatecasechart.com`; `/_search` and `climatepolicyradar.org` are never requested (fetcher log). | `tests/unit/registries/sabin-urls.test.ts`. |
| 13.6 | Site 5xx / throw ⇒ `skipped: climatecasechart.com unreachable (…)`; `sbti` and `repair` steps still run. | `tests/unit/pipeline/sabin-skip.test.ts`. |
| 13.7 | Could-not-check always carries the coverage sentence; `litigation.case` points < `regulator.ruling` points pinned. | `tests/unit/score/weights-v2.test.ts` extended; `tests/unit/registries/sabin-fixtures.test.ts`. |
| 13.8 | E2E: progress step and receipt row (link on `www.climatecasechart.com`); forbidden-word tests green with the new wording. | extend `tests/e2e/analyse-progress.spec.ts`, `tests/e2e/receipts.spec.ts`, 8.8. |
| 13.9 | Validation re-run (offline, and live where the container reaches the sites) committed; RESULTS.md adds the Phase 13 figure. | director compares. |

---

## Phase 14 — Claims-axis formula: measure, then decide ("saying less scores better")

**Context.** v1 scores the claims axis as risky-phrase density per 1,000 words (`claimsRate`), so a page with no environmental claims scores 0 and a page with many substantiated claims scores higher than one with few unsupported ones. Phase 10's Spearman diagnostic measures this. ADR-030 fixes the procedure: implement v2 behind a config switch, report the harness before and after, and the director chooses in the review.

**Deliverables**
1. `config/weights.json` `claimsRate.version: 1 | 2` and a `v2` block: `minClaims` (director's value: 5), `supportedWeight` (= `claim.supported` points / `claim.unsupported` points, i.e. 0.25, read from the points, not duplicated), `insufficientDataStatus: "insufficient_data"`.
2. v2 formula in `scorer.ts` (no literals): let `m` = matched claim sentences (ClaimStats matches + LLM-only claim signals), `u` = unsupported, `s` = supported. If `m < minClaims` ⇒ claims axis status `insufficient_data`: contributes 0 to the score, lowers confidence like a skipped step, and adds the could-not-check line "fewer than <minClaims> environmental claim sentences were found on the fetched pages; the claim-language axis was not scored". Else `subscore = cap(100 × (u + supportedWeight × s) / m)`. Monotonicity (6.2) must still hold: removing a signal may only lower or keep the score — note that removing an unsupported signal lowers `u` and `m` together; the builder proves with the property test that the ratio never rises when a signal is removed **because the test removes signals and recomputes `m` from the remaining set** (document in the test why this holds: removing one unsupported hit lowers `u/m` or triggers `insufficient_data`; removing a supported hit lowers `(u + w s)/m` only if `w ≤ (u + w s)/m`, so the test must assert the implemented clamp: when `m` drops below `minClaims` the axis contributes 0). If the property fails for some input, the builder reports it in `docs/phases/14.md` with the counter-example and keeps v1 as default; the director rules.
3. Both formulas reported: `npm run validate -- --mode offline` and the live subset with `claimsRate.version` 1 and 2 (env override `GR_CLAIMS_VERSION` for the harness only; the app reads the config). `RESULTS.md` gets a "Claims formula v1 vs v2" table: AUC overall, claims-axis AUC, the Spearman diagnostic, and the two regression cases below.
4. Regression fixtures (fictional, `.example`): a "silent" brand (sustainability page with 0 claim sentences, 1,500 words) and a "talkative, substantiated" brand (20 claim sentences, 18 supported); v1 ranks silent < talkative; v2 must rank talkative ≤ silent or mark silent `insufficient_data`.
5. METHODOLOGY Section 11 documents both formulas and which one is active; LIMITATIONS states the trade-off ("a brand that says nothing is not scored on this axis and its confidence is lower").
6. Regulator topic gate (ADR-033): a ruling whose ruled entity equals the brand is scored as `regulator.ruling` only when its topic is environmental (the regulator's own topic field where published, else a whole-word match of `config/regulators.json` `environmentalTopic`, EN and FR, against the ruling title and fetched text); otherwise it is listed with its receipt as `regulator.ruling_other_topic`, 0 points, label "ruling on another topic (<regulator's own topic line or 'topic not established as environmental'>)". Measured on the harness before/after; the pinned TotalEnergies fixture score falls and the pin is updated. If the budget runs out, the formula flip is cut first; the topic gate is not cut.

**Acceptance criteria and proofs**

| # | Criterion | Test |
|---|---|---|
| 14.1 | With `version: 2`, hand cases: `m=10, u=6, s=4` ⇒ `(6 + 0.25×4)/10 × 100 = 70`; `m=4` ⇒ `insufficient_data`, 0 contribution, confidence lower than with `m=5`; `m=20, u=0, s=20` ⇒ 25. | `tests/unit/score/claims-v2.test.ts`. |
| 14.2 | Property (6.2) holds for v2 over 1,000 random signal sets, with `m` recomputed from the remaining signals. | `tests/unit/score/monotonic.test.ts` parametrised over versions. |
| 14.3 | Regression fixtures: ordering as in deliverable 4 for v2; v1 ordering documented in the same test. | `tests/unit/score/claims-regression.test.ts`. |
| 14.4 | `config/weights.json` is the only place the version and `minClaims` live; the methodology page renders the active version; 6.5 and 6.8 green. | existing tests + `tests/e2e/methodology.spec.ts` extended. |
| 14.5 | `RESULTS.md` contains the v1-vs-v2 table with both AUC values and the Spearman diagnostic for both. | `tests/unit/validation/report.test.ts` extended; director reads the committed results files. |
| 14.6 | Decision gate (director, in the review): v2 becomes the default only if overall AUC does not fall by more than 0.02 **and** the Spearman diagnostic moves toward 0 **and** 14.2 is green; otherwise v1 stays default and the ADR says why. The builder ships the config with `version: 1` and the director flips it (config only) when ruling PASS. | ADR-032 (to be written at the Phase 14 review). |
| 14.7 | Topic gate (ADR-033): TotalEnergies "Heures Eco" JDP decision ⇒ `regulator.ruling_other_topic`, 0 points; the Oatly ruling ⇒ scored; the lexicon is read from config. | `tests/unit/regulators/topic-gate.test.ts`. |

---

## Phase 15 — v1.1 docs sync and final review

**Deliverables (builder)**
1. `README.md`: new scripts (`validate`, `record:registries`), new env vars if any, the three new sources with their attribution and licence notes, how to add a registry adapter.
2. `docs/LIMITATIONS.md`: v1.1 reachability facts (from SOURCES.md), the Sabin discovery limit, the data.gouv.fr licence gate, the SBTi snapshot nature (no history), the validation partial-run status, every new `skipped:` reason string (test 9.4 stays green).
3. `docs/METHODOLOGY.md` sections 7, 9b, 9c, 10, 11, 13 consistent with `config/weights.json` v2 (6.8) and the rule registry (3.7).
4. `docs/validation/RESULTS.md` final: Phase 10 baseline, after each source, and the formula comparison, with the leakage line and the partial-run sentences.

**Deliverables (director)**
5. `docs/FINAL-REVIEW-v1.1.md`: one row per Section 10 item re-verified on the final commit, plus one row per v1.1 goal (validation harness, SBTi, FR index, Sabin, claims formula decision), each with the command or test and the observed result; `ai_share` per fixture brand re-pinned.

**Acceptance criteria and proofs**

| # | Criterion | Test |
|---|---|---|
| 15.1 | Fresh clone: `npm ci && npm run build`; `npm run dev` serves `/` 200 within 30 s. | `scripts/smoke.sh` (director). |
| 15.2 | `npm test`, `npm run test:e2e`, `npm run validate -- --mode offline` green with `GR_OFFLINE_FIXTURES=1`. | director runs all three. |
| 15.3 | README commands run as written. | director executes each. |
| 15.4 | LIMITATIONS lists every `reasons` template (9.4) including the v1.1 ones. | `tests/unit/docs/limitations-sync.test.ts`. |
| 15.5 | `ai_share ≤ 0.5` on every fixture brand with the new signals present (all `llm_used: false`). | 6.3, 7.6. |

## v1.1 Definition of Done mapping

| Goal | Proved by |
|---|---|
| Ground truth with citations; harness; labels never feed the score | 10.1, 10.3, 10.4, 10.8 |
| Separation reported, partial runs labelled honestly | 10.3, 10.6, 10.7, RESULTS.md |
| SBTi removed-commitment signal with receipt and attribution | 11.2, 11.5, 11.7 |
| French repairability index on the repair axis, licence-gated | 12.3, 12.4, 12.7 |
| Sabin cases as signals-not-verdicts, conservative matching, robots-clean | 13.3, 13.4, 13.5, 13.7 |
| Claims formula measured before and after; decision logged | 14.1–14.6, ADR-032 |
| Brief Section 10 still met | Phase 15 |

## v1.1 hard limits and pre-authorised cuts

Max 3 rework rounds per phase, max 2 re-plans; counters restart at Phase 10. Pre-authorised cuts, in order, if a phase runs out of budget: Phase 13 seed index (keep the parser and the geography discovery); Phase 12 `possible`-match title search (keep organisation-name equality only); Phase 11 ISIN/LEI matching (keep name equality); Phase 10 live run (keep offline harness, state it); Phase 14 shipped with `version: 1` and the comparison table only. Never cut: ground-truth isolation (10.4), receipts, the licence gate (12.3), robots cleanliness (13.5), the 50% guard.
