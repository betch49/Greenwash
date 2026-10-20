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
- The year window follows the server clock; the fixture histories (2020–2025) stay inside it until 2027, and the 2021 → 2024 removal until 2028.
