# Limitations

Started in Phase 4, completed in Phase 9 (PLAN Phase 9 deliverable 2). Each entry gives the limit, why it exists and what the user sees. Every `skipped: <reason>` line the app can show is listed in the last section. `tests/unit/docs/limitations-sync.test.ts` (criterion 9.4) fails when a reason template in `src/lib/copy/wording.ts` is missing from it.

## Build environment (facts as observed 2026-10-20 / 2026-10-21)

These are properties of the container the app was built in, not of the app. They decide what could and could not be verified.

- **web.archive.org is unreachable from the build container.** Requests either reset or time out:
  - Phase 4 CDX request, 2026-10-20: `curl: (35) Recv failure: Connection reset by peer`.
  - Phase 9 live runs, 2026-10-21: `Connect Timeout Error (attempted address: web.archive.org:443, timeout: 10000ms)` on the first run, `read ECONNRESET` on the second.

  The live Wayback path (CDX query, `id_` snapshot fetch, ≥ 1 s spacing, caching) is implemented and unit-tested against mocked fetchers and recorded-format fixtures. It has **never been run against the real archive.** To verify it, run `npm run e2e:real -- <brand>` on a machine with normal internet access (`docs/LATER.md`, "Wayback live verification in CI"). Until then, every live report from this environment shows `skipped: Wayback unreachable (<cause>)`, and its track-record axis has no archive data.
- **Wikidata rate-limits the container.** It answers HTTP 429 with `Retry-After` up to about 50 s, and sometimes `cirrussearch-too-busy-error`. The fetcher waits as asked: at most 3 tries, at most 60 s per wait. A live search can therefore take 20 s or more before the confirmation step; in the Phase 9 live runs it took 28–29 s. If the lookup still fails, the confirm page shows "Brand lookup unavailable (…)" and offers the URL fallback.
- **No `ANTHROPIC_API_KEY`.** The real Anthropic client has never been called. See "AI-assisted steps".
- **Sites that refuse the build container.** These brands could not be used; we did not try to get around their protection:
  - **bcorporation.net** is Cloudflare-challenged. The certification registry check (differentiator D) is out of v1 (`docs/LATER.md`).
  - **www.patagonia.com** serves a bot wall ("Hang Tight! Routing to checkout...") for every URL, including robots.txt. Under ADR-012 the app treats that as "robots.txt unavailable" and fetches nothing from the site. Mammut replaced Patagonia as the outdoor-apparel fixture brand. The Phase 1 Wikidata fixtures for "patagonia" remain, so an offline Patagonia run ends with `skipped: no page could be fetched from patagonia.com`.
  - **Fjällräven** answers Cloudflare 403 and **Picture Organic** answers 429.
- **`npm audit`** reports vulnerabilities in the dependency tree:
  - The two that reach production dependencies are in the `postcss` copy bundled by `next` 15.5. They are fixed only by `next` 16, a breaking upgrade that is not part of v1.
  - The rest are in development-only tools (`lighthouse` and its dependencies).
  - The app does not process user-supplied CSS.

## Fixtures and offline mode

- **Offline mode is a test mode** (`GR_OFFLINE_FIXTURES=1`). Every fetch is answered from `fixtures/`, and a URL with no recording answers HTTP 404. A report made offline shows how the app behaves on captured pages. It is not a current report on the brand.
- **Real captures, fixed in time.** Mammut, Fairphone and Oatly pages, their Wikidata answers and the ASA, JDP and iFixit answers are real captures from 2026-10-20 and 2026-10-21 (`fixtures/brands/README.md`, `fixtures/sources/README.md`). Inline `<script>` bodies were stripped, and sitemaps over 1 MB were reduced to their `<loc>` list.
- **Fetch dates can postdate the pinned clock.** Offline, each receipt carries the capture date of its fixture as its fetch date, while the Playwright and Lighthouse runs pin the clock to `GR_FIXED_NOW=2026-10-20T00:00:00Z`. The iFixit captures were made on 2026-10-21, so Fairphone's iFixit receipts read "fetched 2026-10-21" in a report "generated 2026-10-20". The dates are true capture dates; only the report clock is pinned. A live run uses the real clock throughout.
- **Two fictional brands with synthetic content (ADR-011).** Northwind Outdoor (`https://www.northwind-outdoor.example`) and Quillmoor Foods (`https://www.quillmoor-foods.example`):
  - They are on reserved `.example` domains and have no Wikidata entity.
  - Their pages and Wayback histories are hand-built and marked `synthetic fixture`.
  - No real company published their text, and no real brand's URL carries hand-built content (guard test `tests/unit/fetch/brand-fixtures.test.ts`).
  - They exist because no real archive answer could be recorded. They are the only brands where the removed-claim signal (differentiator A) and a non-zero `ai_share` are exercised.
- **Consequence for the real fixture brands (ADR-011).** No real CDX or snapshot response could be recorded, so Mammut, Fairphone and Oatly have **no** archived history. Offline, their Wayback step reads `skipped: Wayback unreachable (HTTP 404)`: the fixture fetcher answers 404 for every unrecorded request, and the step treats "no CDX answer for any page" as the archive being unavailable.
- **LLM fixtures are hand-authored stand-ins.** See "AI-assisted steps".

## Brand pages and the claim engine (differentiator F)

- **What is fetched.** Server-rendered HTML only, with no JavaScript rendering. A page that needs scripts to show its text is skipped as `too little visible text`.
- **How many pages.** At most 12 pages per brand (`config/discovery.json`), found through the sitemap and heuristic paths.
- **What is not read.** PDFs (often where impact reports live) are linked, not read. Site chrome (navigation, header, footer, aside) is removed from the text.
- **English phrase lists, not understanding** (ADR-015, METHODOLOGY Section 8):
  - A sentence that quotes someone else, criticises a practice, states a global statistic or advocates a policy can match a claim rule. This was seen on Oatly, Mammut and Fairphone pages; for example, campaign text calling for regulation, or a quoted industry figure.
  - Every match is shown with its sentence and URL, so a reader can judge it.
  - A quote and stance filter is in `docs/LATER.md`.
- **Same-page substantiation only.** A claim counts as substantiated only when a figure with a unit, a named standard or a report link appears next to it on the same page. Data one link away does not count, and nothing in a PDF counts.
- **Labels are not verified.** Labels named on a page (B Corp, Fairtrade, …) are listed under "What we could not check" as "label claimed on page; not verified in v1". No registry is queried, and a label never enters the score.
- **robots.txt.**
  - Fail closed (ADR-012): a robots.txt that answers 5xx, fails on the network or is an HTML page blocks the whole origin for that run, with the reason shown.
  - On a failed live fetch, the last cached robots.txt is used (Phase 8). Without a cached copy, the origin is skipped.
  - A robots-disallowed page is never fetched live. Its archived copies may be read for the timeline (ADR-016).
- **API endpoints are exempt from robots.txt (ADR-010).** Wikidata's robots.txt disallows `/w/`, which covers the API the brief requires. The exemption covers only the brief-mandated API endpoints (Wikidata, Wayback CDX and `id_`). Brand pages, regulator pages and iFixit always go through the robots guard.

## Archived claims (differentiator A)

- At most three pages per brand get a history lookup (`config/wayback.json` `maxPages`), one snapshot per calendar year over the last eight years. A claim that appeared and vanished within one calendar year is not seen.
- With `collapse=timestamp:4` the archive returns the first capture of each year, so "present in 2021" means present in the first 2021 capture.
- A claim moved to a different page counts as removed from the page it left. Rewording at ≥ 0.8 similarity, moving within the page or putting it under a heading does not count.
- The newest archived copy is compared with the live page (ADR-017), but only for pages fetched live; a robots-disallowed page's history ends with its newest archived copy.
- The Wayback API endpoints are not checked against robots.txt (ADR-010); brand pages always are.
- The year window follows the server clock. In offline fixture mode only, `GR_FIXED_NOW` pins it (the Playwright run sets 2026-10-20, so the fixture histories always fall in 2019–2026); live runs ignore it.
- Robots-disallowed pages (ADR-016): their archived copies are diffed for the timeline and removed-claim signals, but never scored on the claims axis as current wording. Their "What we could not check" line says whether archived copies were read (count, years), none were found, the archive was unreachable, or the page was not looked up.

## Regulator rulings (differentiator C)

- Only the UK ASA and the French JDP are searched (ADR-003); every report says so under "What we could not check". A brand that never advertised in the UK or France has no ruling to find.
- Only the first page of each site's search results is read, and at most five ruling pages per regulator per run (`config/regulators.json`). ASA's search returned all 19 hits for "Shell" on one page; JDP's listing shows its first cards only.
- Matching is deliberately strict (METHODOLOGY Section 9.5): a ruling against a subsidiary or sister company whose name carries extra words ("Shell Energy UK") is shown as a possible match and not scored. A ruling against a differently named legal entity of the brand (for example a parent company) is not found at all; that is the price of never attaching a ruling on a fuzzy match.
- A ruling is attributed by name, not by legal identity: two unrelated companies with the same name after normalisation would be confused. The ruled entity is always shown verbatim, so a reader can see it.
- The search query is the brand name; ASA's and JDP's own search engines decide what they return.

## SBTi target status (Phase 11, ADR-026)

- The SBTi companies export is a **snapshot**; SBTi publishes no history. A commitment that SBTi removed and later re-listed, or a row SBTi deleted, is not visible to a new report; a stored report keeps what the export said on its fetch date (the receipt's date).
- "Commitment Removed" is reported as SBTi published it, with SBTi's own `status_reason`; it is not a verdict about the brand. Reasons that are not the brand walking back ("Target set at parent company level", "Company change") are a 0-point status note. A removal whose reasons mix a neutral and a non-neutral item is scored.
- `date_updated` is the date SBTi last changed the row, used as the removal date for the recency multiplier; the export carries no separate removal date.
- Matching is the strict name rule of METHODOLOGY 9.5 on `company_name`, plus ISIN/LEI equality with the Wikidata entity when Wikidata has those identifiers (few entities do). A brand listed under a group name ("Mammut Sports Group" for "Mammut", "INGKA Holding B.V. (IKEA Group)") is a possible match, shown and not scored; a brand listed under an unrelated parent name is not found.
- Offline mode and the tests serve a **trimmed** recorded export (fixture and test-case brands plus 50 random rows; `fixtures/sources/sbti/README.md`), so an offline run of a brand outside that list finds nothing. Ground-truth brands are added by re-running `npm run record:registries -- sbti` once `fixtures/validation/ground-truth.json` exists.
- SBTi's terms allow non-commercial use with credit; every SBTi receipt carries the attribution line. Commercial use would need SBTi's permission.

## Ownership and repair (differentiator E)

- iFixit is read through its device-category endpoint, because its robots.txt disallows the search API (`docs/CHALLENGES.md` C-2). A brand whose iFixit category has a different name from the brand (or none) gets no iFixit signal; the report says "iFixit lists no device category named …".
- At most three device sub-categories (the last ones listed) are read; for a large brand they are not necessarily its newest or best-selling products.
- Brand-page rules are English phrase lists on the fetched pages only. A warranty described differently ("two years of cover"), or only in a PDF, is not seen. A "guarantee" is counted as a warranty.
- Food, drink and other consumables (by Wikidata industry) are "not applicable"; a brand with no industry on Wikidata is treated as durable, so a food brand without that property would get a `repair.no_repair_info_found` signal.
- Anti-repair practices are not checked (`docs/LATER.md`).
- **French repairability index (Phase 12, ADR-027).** French market only: a brand that publishes no *indice de réparabilité* dataset on data.gouv.fr (most non-French brands, and every brand outside the product categories the index covers) gets one "What we could not check" line and no signal. Most datasets carry no licence (`notspecified`, 41 of 45 inspected by the director): they are only linked under "What we could not check", never read or scored, so in practice only a handful of publishers (Fairphone, BSH, Groupe SEB, Vestel and a few others under Licence Ouverte 2.0 or public domain) can produce a signal. Matching is by publisher name: a dataset published by a distributor or a French subsidiary with a different name (e.g. "BSH ELECTROMENAGER" for Bosch appliances) is not attributed to the brand. The dataset search API's pages overlap (125 results reported, 115 distinct on the two pages recorded on 2026-10-21), so a dataset can be missed. `static.data.gouv.fr`'s robots.txt disallows `/resources`, so CSVs are read through data.gouv.fr's tabular API export; a resource the tabular API has not ingested cannot be read (`docs/CHALLENGES.md` C-12.1). The threshold (mean below 5.0/10) is a director's value set before measurement.

## Score and confidence (Phase 6)

- Points are risk points only (`docs/CHALLENGES.md` C-4): a protective finding (report, emissions figure, supplier list, manual, parts, warranty, iFixit) earns 0 points and lowers a sub-score only by replacing the risk signal that would otherwise appear. An absolute emissions figure or a supplier list therefore does not move the score; it is listed and counts as data for confidence.
- Confidence is per axis and binary: an axis counts in full once one of its steps finished and it produced a signal (or, for track record, an archived snapshot). A track record built from regulator searches with no ruling and no archived history counts as missing (Mammut and Fairphone offline: confidence 70%), and a track record with a ruling but an unreachable Wayback Machine counts in full.
- The claims axis is a rate over all fetched visible words. A brand whose site has many pages without claims gets a lower claims sub-score than one with a single sustainability page carrying the same sentences.
- **The claims rate's denominator is the fetched word count.**
  - A page that fails to fetch, or is skipped, lowers the denominator, so the same claim sentences on the remaining pages give a higher claims rate.
  - Brief Section 4 prescribes the per-1,000-word normalisation, so this is a documented property, not a defect.
  - The `minWords` floor (`config/weights.json`) stops a very short fetch from inflating the rate.
  - The pages that were and were not fetched are listed on the report.
- **The label is two words, not the brief's "three-word label".** It is "Low signals" / "Moderate signals" / "High signals" (`scoreWording.label`), the wording accepted in Phase 6. It always appears next to the score and confidence, never on its own.
- The numbers in `config/weights.json` (points, caps, label thresholds, the claims-rate multiplier) are design choices, not calibrated against an external dataset; they are all shown on /methodology.

## AI-assisted steps (Phase 7)

- **No API key in the build environment.** The real Anthropic client is wired and unit-tested with a stubbed SDK (request shape, tool-use parsing, refusal and error handling), but it has not been called against the real API. The offline LLM fixtures in `fixtures/llm/` are hand-authored stand-ins (`scripts/author-llm-fixtures.ts`), not model output; each file says so. They exercise the plumbing (validation, rule re-scan, keep/halve/drop, URL allow-list), not the model's judgement.
- Fixture files are keyed by a hash of the exact input, so any change to a page fixture, to an input builder or to a report the summary reads needs `npm run author:llm` (or a recording run with a key). A run whose input has no file gets an empty answer: in the Playwright flow, a brand reached through the URL fallback has the typed query as its name, so its summary input differs from the recorded one and the page shows "Summary unavailable".
- Without a key outside offline mode, the three AI-assisted steps are skipped with "LLM unavailable (no API key)" and the report uses the rule-based signals only.
- Temperature 0 is not sent to the default model, which rejects sampling parameters (`docs/CHALLENGES.md` C-5); two runs of the real model can differ, but only within what the validation lets through.
- LLM answers are not cached in SQLite; a re-run with a key calls the API again (reports themselves are stored).
- At most three pages per run are read by the claim proposer, at most 30,000 characters each (`config/llm.json`), and at most 20 removals are classified.

## Report page and cache (Phase 8)

- A stored report is re-served, without running anything, to a new search for the same brand identity within `GR_REPORT_TTL_HOURS` (default 168): the same website (spellings with and without a trailing slash count as one) **and** the same confirmed Wikidata entity, or, for a pasted website, the same typed name (case-insensitive). A report made under another name or entity is never served for a search. "Re-run the analysis" on the report always starts a new run.
- `/report/[id]` and `/api/reports/<id>.json` always read the stored `ReportV1` from SQLite; the `x-gr-served-from: cache` header says exactly that (it is a static route header, not a per-request measurement).
- The brand logo (Wikidata P154, loaded from Wikimedia Commons) is shown only online; offline/fixture mode never renders it, so the offline tests do not exercise it.
- A "possible" regulator match (ADR-019) is listed under "What we could not check" → "Possible matches (not scored)". No fixture brand has one; the e2e test stores a copy of the fictional Northwind report with one such line.
- The stand-in summary for the URL-fallback e2e input ("acme" + the Northwind website) is hand-authored like the other LLM fixtures (ADR-021) and must be re-recorded once an API key exists.

## Operations

- **Single process, single SQLite file (ADR-013).** Runs execute inside the web server process.
  - There is no job queue and no resume. A run interrupted by a restart is marked failed when it is next viewed, and shows `skipped: analysis interrupted (server restarted); search again to retry`.
  - Two server processes on one database would each consider the other's runs interrupted.
- **Run rows from GET.** A confident match on `/confirm` creates a run row while the page renders; the pipeline itself only starts on an explicit POST from `/analyse` (ADR-013). A crawler hitting `/confirm?q=…` creates rows but never fetches anything.
- **The `signals` table is unused (Phase 9 decision).**
  - PLAN Phase 1 named the table, and it is still created.
  - Every signal is stored inside the report's `ReportV1` JSON (`reports.data`). The report page, the JSON export and the cache read only that.
  - Nothing writes or reads the table. It is kept so the planned schema stays intact (`src/lib/db/schema.ts` says so); a per-signal query store would use it later.
- **No authentication and no rate limit on searches.** Anyone who can reach the server can start runs. That suits the single-user, local v1; a public deployment would need a limit.
- **Dev server timings.** `next dev` compiles routes on first use, and its re-serve path is slower than production: the Phase 9 live run measured about 1.4 s for a re-served search on `next dev` and 15–80 ms on `next start`. The < 1 s requirement is measured on the production server and in tests 8.5.

## What "What we could not check" means

Every report has a "What we could not check" section. It lists, in plain words, what this report did **not** cover, so a missing signal is never read as a clean result:

- the regulator coverage line (only ASA and JDP);
- pages robots.txt kept us from fetching (and whether archived copies were read instead);
- origins whose robots.txt could not be read;
- an unreachable or empty Wayback history;
- labels claimed but not verified;
- a repair axis that does not apply (food and drink);
- iFixit not checked;
- AI steps not run;
- "possible" regulator matches (not scored).

The "Skipped steps" list gives the step-level `skipped: <reason>` lines. An axis with no usable data is marked "no data (lowers confidence)" and is not scored as zero risk.

## Deferred Definition-of-Done items

- **"One real brand end to end with a key; served from cache < 1 s afterwards": deferred: no API key.** The live half was done without a key on 2026-10-21 (`docs/phases/9.md`, `docs/phases/9-real-run.json`): Fairphone, live through `next start`, AI steps skipped as "LLM unavailable (no API key)", Wayback unreachable. The re-serve was measured from the stored report. With a key, run `npm run build && npm run e2e:real -- fairphone --website https://www.fairphone.com --prod`.
- **Live Wayback: deferred: unreachable in the build environment** (see above).
- **Recorded LLM fixtures: deferred: no API key** (`docs/LATER.md`).

## Every "skipped: <reason>" the app can show

`<…>` marks a value filled in at run time. The templates live in `src/lib/copy/wording.ts` (`reasons`), except the robots.txt one, which lives with its error class in `src/lib/fetch/robots.ts`.

| Shown as | When |
|---|---|
| `skipped: the website address is not usable (<website>)` | The run's website is not an http(s) URL. |
| `skipped: no candidate pages were found` | Discovery found no page to fetch on the site. |
| `skipped: no page could be fetched from <host>` | Every candidate page failed (robots, HTTP error, too little text). |
| `skipped: HTTP <status> for <url>` | A page answered with an error status. |
| `skipped: could not fetch <url> (<message>)` | Network failure after 3 tries. |
| `skipped: too little visible text at <url> (<words> words)` | Probably a JavaScript-rendered page (no JS rendering in v1). |
| `skipped: not an HTML page: <url> (<type>)` | PDF or other non-HTML content. |
| `skipped: robots.txt disallows <url>` | robots.txt forbids the page; archived copies may be read instead (ADR-016). |
| `skipped: robots.txt unavailable for <origin> (<cause>)` | robots.txt unreadable (5xx, network, HTML bot wall): the whole origin is skipped (ADR-012). |
| `skipped: analysis interrupted (server restarted); search again to retry` | The server restarted during the run (ADR-013). |
| `skipped: internal error (<message>)` | Defined but not emitted in v1: a step that throws unexpectedly shows the error's own message as `skipped: <message>` (`src/lib/pipeline/run.ts`), and the run goes on with the other steps. |
| `skipped: no fetched page to scan` | The claim, evidence or repair step had no page. |
| `skipped: Wayback unreachable (<cause>)` | The Wayback Machine did not answer (always the case from the build environment). |
| `skipped: no sustainability-type page to look up in the Wayback Machine` | No page qualified for a history lookup. |
| `skipped: <name> unreachable (<cause>)` | ASA or JDP did not answer. |
| `skipped: <name> <what> could not be parsed` | The regulator's page structure changed. |
| `skipped: not applicable: the brand’s industry on Wikidata is “<industry>”, whose products are consumed, not repaired` | Food, drink and other consumables (repair axis). |
| `skipped: iFixit unreachable (<cause>)` | iFixit did not answer. |
| `skipped: iFixit lists no device category named “<name>”` | No iFixit category with the brand's name. |
| `skipped: no API key` | AI steps without `ANTHROPIC_API_KEY`, as the inner reason. |
| `skipped: no LLM client configured` | AI steps with no client (tests). |
| `skipped: LLM unavailable (<why>)` | AI steps not run, for example `LLM unavailable (no API key)`. |
| `skipped: <what>: AI output rejected (<why>)` | The model's answer failed validation; it is dropped and the rule-based signals stand. |
| `skipped: <what>: AI call failed (<why>)` | API error or refusal. |
| `skipped: <what>: no AI answer` | No answer, or no fixture for this input offline. |
| `skipped: no fetched page to read` | The claim proposer had no page. |
| `skipped: no removed claim to classify` | The diff classifier had nothing to classify. |
| `skipped: SBTi export unreachable (<status>)` | The SBTi export did not answer 200 (network error, robots.txt, HTTP status). Template: `sbtiWording.unreachable`. |
| `skipped: SBTi export could not be parsed` | The export is not a readable .xlsx with the expected columns. Template: `sbtiWording.unparsable`. |
| `skipped: data.gouv.fr unreachable (<cause>)` | The data.gouv.fr dataset list did not answer after the retries (Phase 12). |
| `skipped: repairability dataset could not be parsed (<url>)` | The dataset list or the only readable repairability CSV is not in the expected format (Phase 12). |
