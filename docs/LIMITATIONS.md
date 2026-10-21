# Limitations

Started in Phase 4; completed in Phase 9 (PLAN Phase 9 deliverable 2). Each entry says what the limit is, why, and what the user sees.

## Build environment

- **web.archive.org is unreachable from the build container.** Every request is reset by the network (`curl: (35) Recv failure: Connection reset by peer`, re-checked 2026-10-20 at the start of Phase 4 with one brief CDX request). The live Wayback path (CDX query, `id_` snapshot fetch, ≥ 1 s spacing, caching) is implemented and unit-tested against mocked fetchers, but has not been run against the real archive. To verify it, run the app without `GR_OFFLINE_FIXTURES` on a machine with normal internet access (see `docs/LATER.md`, "Wayback live verification in CI").
- **Consequence for fixtures (ADR-011).** No real CDX or snapshot response could be recorded, so the three real fixture brands (Mammut, Fairphone, Oatly) have **no** archived history. Offline, their Wayback step reads `skipped: Wayback unreachable (HTTP 404)`: the offline fixture fetcher answers 404 for every request it has no recording for, and the step treats "no CDX answer for any page" as the archive being unavailable. The removed-claim and redesign cases are exercised on two **fictional** brands on reserved `.example` domains (Northwind Outdoor, Quillmoor Foods) whose snapshot histories are hand-built and marked `synthetic fixture`; no real brand's URL carries a hand-built snapshot (guard test `tests/unit/fetch/brand-fixtures.test.ts`).

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

## Ownership and repair (differentiator E)

- iFixit is read through its device-category endpoint, because its robots.txt disallows the search API (`docs/CHALLENGES.md` C-2). A brand whose iFixit category has a different name from the brand (or none) gets no iFixit signal; the report says "iFixit lists no device category named …".
- At most three device sub-categories (the last ones listed) are read; for a large brand they are not necessarily its newest or best-selling products.
- Brand-page rules are English phrase lists on the fetched pages only. A warranty described differently ("two years of cover"), or only in a PDF, is not seen. A "guarantee" is counted as a warranty.
- Food, drink and other consumables (by Wikidata industry) are "not applicable"; a brand with no industry on Wikidata is treated as durable, so a food brand without that property would get a `repair.no_repair_info_found` signal.
- Anti-repair practices are not checked (`docs/LATER.md`).

## Score and confidence (Phase 6)

- Points are risk points only (`docs/CHALLENGES.md` C-4): a protective finding (report, emissions figure, supplier list, manual, parts, warranty, iFixit) earns 0 points and lowers a sub-score only by replacing the risk signal that would otherwise appear. An absolute emissions figure or a supplier list therefore does not move the score; it is listed and counts as data for confidence.
- Confidence is per axis and binary: an axis counts in full once one of its steps finished and it produced a signal (or, for track record, an archived snapshot). A track record built from regulator searches with no ruling and no archived history counts as missing (Mammut and Fairphone offline: confidence 70%), and a track record with a ruling but an unreachable Wayback Machine counts in full.
- The claims axis is a rate over all fetched visible words. A brand whose site has many pages without claims gets a lower claims sub-score than one with a single sustainability page carrying the same sentences.
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
