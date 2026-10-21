# Final review — Definition of Done (brief Section 10)

Written by the director on 2026-10-21 after the Phase 9 review (commit `9c69a58`, branch `claude/new-session-g9w7x3`). Every command below was run by the director on that commit in the build container; results are the observed ones, not the builder's. The run is **finished**: every Section 10 item is met, except the single item the brief allows to be deferred when no API key exists, which is marked "deferred: no API key".

## Section 10 checklist

| # | DoD item | Command or test that proves it | Observed |
|---|---|---|---|
| 1 | `npm install && npm run dev` starts with no errors | `rm -rf node_modules .next && npm install && GR_OFFLINE_FIXTURES=1 npm run dev -- -p 3141`; `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3141/` | install exit 0; `/` → 200 after 3 s; log has `✓ Ready in 1508ms`, no `error`/`unhandled`/`failed to compile`; server stopped afterwards. `bash scripts/smoke.sh` (criterion 9.1: `npm ci && npm run build`, then `next dev`) → `smoke: OK`. |
| 1 | `npm test` passes | `GR_OFFLINE_FIXTURES=1 npm test` | 57 files, 425/425 passed, 0 skipped. Also `npm run lint`, `npm run typecheck`, `npm run build` all clean. |
| 1 | Playwright flow passes | `GR_OFFLINE_FIXTURES=1 npm run test:e2e` | 45/45 passed (Chromium, offline fixtures, pinned clock `2026-10-20`, throw-away `test-results/e2e.db`), 3.7 min. |
| 2 | Three screens work on phone and desktop: search → confirm (or URL fallback) → report | `tests/e2e/search-confirm.spec.ts`, `tests/e2e/full-flow.spec.ts` (desktop Chrome, criteria 1.6, 1.7, 1.9, 8.1), `tests/e2e/mobile.spec.ts` (iPhone 12 device profile, 8.6); `docs/phases/8-lighthouse.json` | Green in the 45/45 run above. "patagonia" → confirm → proceeds; "acme" → URL fallback; "continental" → cards. Lighthouse accessibility 100 on `/`, `/confirm` (cards and fallback), `/report/[id]`, `/methodology` (minimum 90). |
| 3 | One real brand end to end with a working `ANTHROPIC_API_KEY`; same report served from cache afterwards in < 1 s | `npm run build && npm run e2e:real -- fairphone --website https://www.fairphone.com --prod` | **Deferred: no API key** (brief Section 6). The live half ran without a key on 2026-10-21 (`docs/phases/9-real-run.json`): Fairphone, live `next start`, Wikidata auto-matched, pipeline 52.3 s, score 3 / "Low signals" / confidence 70% / ai_share 0, 24 receipted signals from 2 sources, AI steps shown as `skipped: LLM unavailable (no API key)`, Wayback `skipped: Wayback unreachable (read ECONNRESET)`. Re-serve: `GET /report/<id>` 45 / 33 / 27 ms with `x-gr-served-from: cache`; a second identical search redirected to the same report id in 100 ms. On `next dev` the re-serve exceeded 1 s (dev compilation); the production measurement is the one judged (ADR-023). Offline, test 8.5 (`tests/e2e/cache.spec.ts`) pins the re-serve path. |
| 4 | Each chosen differentiator produces ≥ 1 receipted signal on a fixture brand | A: `tests/unit/wayback/retraction.test.ts` (4.4); C: `tests/unit/regulators/fixtures.test.ts` (5.4); E: `tests/unit/repair/fixtures.test.ts` (5.6/5.8); F: `tests/unit/claims/fixtures.test.ts` (3.4) | All green; the signals are listed in the next section. |
| 5 | `ai_share ≤ 0.5` enforced by a test, and shown in the UI | `tests/unit/score/ai-share.test.ts` (6.3: a synthetic report with every signal LLM-flagged still yields ≤ 0.5), `tests/unit/llm/ai-share-fixtures.test.ts` (7.6: per fixture brand); UI `src/app/report/[id]/page.tsx` `data-testid="ai-share"` → "AI contributed to N% of this score" (`tests/e2e/full-flow.spec.ts`) | Green. Values per brand below. |
| 6 | Every signal shown has a source URL, a fetch date and an excerpt; "What we could not check" populated honestly | `assertReceipt` in `src/lib/pipeline/signal.ts` drops unreceipted signals (`tests/unit/pipeline/signal.test.ts` 2.5, `tests/unit/score/receipts.test.ts` 6.4); `tests/e2e/receipts.spec.ts` checks every receipt row has an http link, a fetch date and an excerpt, and that could-not-check and skipped steps are rendered (8.2/8.3) | Green. Live Fairphone report's could-not-check: Wayback unreachable, AI steps not run, Fairtrade label claimed but not verified, regulator coverage limited to ASA and JDP. |
| 7 | `docs/METHODOLOGY.md`, `docs/LIMITATIONS.md`, `docs/DECISIONS.md`, `README.md` exist and match the code | `tests/unit/score/methodology-sync.test.ts` (6.8: METHODOLOGY = `config/weights.json`), `tests/unit/claims/methodology-sync.test.ts` (3.7: rules documented), `tests/unit/docs/limitations-sync.test.ts` (9.4: every `reasons` template verbatim in LIMITATIONS), `tests/unit/copy/forbidden.test.ts` (wording); README env vars checked against `grep -rn "process.env" src scripts`, README scripts table against `package.json` | All four files exist; tests green; every README command was executed as written by the director (criterion 9.3). DECISIONS has ADR-001…023. |

## The three differentiators and their receipted signal on a fixture brand

Chosen in ADR-002: **A, C, E**, plus the mandatory **F** baseline. All four produce receipted signals; `llm_used: false` on each of the signals below.

| Differentiator | Fixture brand | Signal kind | Receipt (source URL, fetch date, excerpt) | Proof |
|---|---|---|---|---|
| **A** Claim retraction (Wayback) | Northwind Outdoor (fictional, synthetic archive, ADR-011) | `claim.removed` — "Claim removed between 2021 and 2024" | source: the `web.archive.org/web/<ts>id_/…` snapshot of the sustainability page, `snapshot_date` 2021-03-15, fetch date from the fixture capture, excerpt: the removed sentence containing "climate neutral" | `tests/unit/wayback/retraction.test.ts` (4.4: exactly one `claim.removed`, `id_` URL, excerpt has "climate neutral"); `tests/e2e/timeline.spec.ts` (4.7: timeline row "claim removed between 2021 and 2024") |
| **C** Regulator rulings | Oatly (real capture) | `regulator.ruling` — "Ruling found naming Oatly UK Ltd t/a Oatly (ASA, United Kingdom, 2022-01-26); outcome as published: Upheld in part" | `https://www.asa.org.uk/rulings/oatly-uk-ltd-g21-1096286-oatly-uk-ltd.html`, fetched 2026-10-21, excerpt: the ruling page's first 300 characters | `tests/unit/regulators/fixtures.test.ts` (5.4), `tests/unit/regulators/asa-uk.test.ts` |
| **E** Ownership & repair | Fairphone (real capture) | `repair.manual_found`, `repair.spare_parts_found`, `repair.warranty_found` (5-year), `repair.program_found`, `repair.ifixit_guides`, `repair.ifixit_score` | fairphone.com support/repair pages and `https://www.ifixit.com/api/2.0/wikis/CATEGORY/Fairphone` device categories, fetched 2026-10-20 / 2026-10-21, excerpts: the matched page line or the guide titles | `tests/unit/repair/fixtures.test.ts` (5.6/5.8: `receiptProblem` null on every signal); live run reproduced the same 9 repair signals |
| **F** Claim-language engine (baseline) | Fairphone, Mammut, Oatly | `claim.unsupported` / `claim.supported` per matched sentence (vague, absolute, offset, baseline-less, future-only families) | the fetched brand page URL, its fetch date, excerpt: the matched sentence ≤ 300 chars | `tests/unit/claims/fixtures.test.ts` (3.4), `tests/unit/claims/rules.test.ts` (20-sentence set) |

## `ai_share` per fixture brand

Pinned by `tests/unit/llm/ai-share-fixtures.test.ts` with the (hand-authored) LLM fixtures active; the 50% guard is `tests/unit/score/ai-share.test.ts`.

| Brand | Score | `ai_share` | LLM-flagged signals |
|---|---|---|---|
| Mammut (outdoor apparel) | 12 | 0 | 0 |
| Fairphone (electronics) | 3 | 0 | 0 |
| Oatly (food) | 35 | 0 | 0 |
| Northwind Outdoor (fictional) | 34 | 9/34 ≈ 0.265 | 2 |
| Quillmoor Foods (fictional) | not pinned | 0 | 0 |

Live Fairphone (no key): `ai_share` 0. The UI shows "AI contributed to N% of this score" on every report.

## Rework and re-plan counts

| Phase | Verdict history | Rework rounds (max 3) |
|---|---|---|
| 1 | PASS | 0 |
| 2 | REWORK → PASS | 1 |
| 3 | REWORK → PASS | 1 |
| 4 | REWORK → PASS | 1 |
| 5 | PASS | 0 |
| 6 | PASS | 0 |
| 7 | PASS | 0 |
| 8 | PASS | 0 |
| 9 | PASS | 0 |

Re-plans used: **0 of 2**. Scope cuts: none of the pre-authorised cuts was needed. Differentiator D (certification registry) was never in scope (ADR-002; bcorporation.net blocked). Deliverable wording was aligned under ADR-011, -014, -017, -018, -019 without changing a criterion, scope or phase (not counted as re-plans; reasoning in each ADR).

## Deferred item

- **Section 10 item 3, "at least one real brand produces a report end to end with a working `ANTHROPIC_API_KEY`": deferred: no API key.** The key was absent for the whole build (brief Section 6 anticipates this). Everything else passes with the mocked LLM. To complete it on a machine with a key and normal internet access: `npm run build && ANTHROPIC_API_KEY=… npm run e2e:real -- fairphone --website https://www.fairphone.com --prod`; the script exits 1 if the re-serve is missing or takes ≥ 1 s and writes `docs/phases/9-real-run.json`. Then re-record the LLM fixtures (`docs/LATER.md`).

Related build-environment facts, documented in `docs/LIMITATIONS.md` and not DoD items: the live Wayback path has never reached web.archive.org from this container (unit-tested against recorded formats; removed-claim cases use the fictional brands); `npm audit --omit=dev` reports two `postcss` advisories inside `next` 15.5, accepted under ADR-023.

## Director's closing judgment

- AI is a minority component: the score is a deterministic formula over `config/weights.json`; the LLM only proposes candidate claims (re-scanned by the rules), classifies diffs (keep/halve/drop within a cap) and writes the summary from fetched URLs; `ai_share` cannot exceed 0.5 by construction and by test.
- Receipts: no signal reaches the report without URL, fetch date and excerpt (`assertReceipt`).
- Wording: "signals, not verdicts" is enforced by `tests/unit/copy/forbidden.test.ts` over every string in `src/` and by `tests/e2e/wording.spec.ts` on rendered pages.
- Honesty about gaps: every skipped step is shown as `skipped: <reason>`; "What we could not check" is populated on every report, including the live one.

Commands to run the app: `npm install && npm run dev` (live), or `GR_OFFLINE_FIXTURES=1 GR_FIXED_NOW=2026-10-20T00:00:00Z npm run dev` (offline fixtures). Tests: `npm test`, `npm run test:e2e`.
