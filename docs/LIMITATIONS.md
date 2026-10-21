# Limitations

Started in Phase 4; completed in Phase 9 (PLAN Phase 9 deliverable 2). Each entry says what the limit is, why, and what the user sees.

## Build environment

- **web.archive.org is unreachable from the build container.** Every request is reset by the network (`curl: (35) Recv failure: Connection reset by peer`, re-checked 2026-10-20 at the start of Phase 4 with one brief CDX request). The live Wayback path (CDX query, `id_` snapshot fetch, ≥ 1 s spacing, caching) is implemented and unit-tested against mocked fetchers, but has not been run against the real archive. To verify it, run the app without `GR_OFFLINE_FIXTURES` on a machine with normal internet access (see `docs/LATER.md`, "Wayback live verification in CI").
- **Consequence for fixtures (ADR-011).** No real CDX or snapshot response could be recorded, so the three real fixture brands (Mammut, Fairphone, Oatly) have **no** archived history. Offline, their Wayback step reads `skipped: Wayback unreachable (HTTP 404)`: the offline fixture fetcher answers 404 for every request it has no recording for, and the step treats "no CDX answer for any page" as the archive being unavailable. The removed-claim and redesign cases are exercised on two **fictional** brands on reserved `.example` domains (Northwind Outdoor, Quillmoor Foods) whose snapshot histories are hand-built and marked `synthetic fixture`; no real brand's URL carries a hand-built snapshot (guard test `tests/unit/fetch/brand-fixtures.test.ts`).

## Archived claims (differentiator A)

- At most three pages per brand get a history lookup (`config/wayback.json` `maxPages`), one snapshot per calendar year over the last eight years. A claim that appeared and vanished within one calendar year is not seen.
- With `collapse=timestamp:4` the archive returns the first capture of each year, so "present in 2021" means present in the first 2021 capture.
- A claim moved to a different page counts as removed from the page it left. Rewording at ≥ 0.8 similarity, moving within the page or putting it under a heading does not count.
- The newest snapshot is not compared with the live page; a claim removed after the last archived copy is not reported.
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
