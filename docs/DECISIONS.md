# Greenwash Radar — Decisions (ADR log)

One entry per decision. Format: context, decision, consequences. Entries are appended, never rewritten; a reversal is a new entry that supersedes the old one. The human reads this file after the run.

---

## ADR-001 — Orchestration fallback: agent files not loaded, built-in agent used with pasted role content

**Date:** 2026-10-20
**Status:** accepted

**Context.** Brief Section 0.1 says `.claude/agents/director.md` and `.claude/agents/builder.md` were to be committed before the session started. They were in fact committed during this session (commit `d01d614`, "setup: brief and agents"), and a running session does not pick up agent files created during it. Both agents are reported as not found.

**Decision.** Apply the fallback of Section 0.1: the orchestrator calls the built-in `general-purpose` agent and pastes the full content of the corresponding agent file at the top of every task prompt. The director runs with the `claude-fable-5-1` model override (effort medium); the builder runs with `claude-opus-5-5`. Role boundaries from the agent files still apply: the director writes only under `docs/`, the builder never changes scope or weights.

**Consequences.** Behaviour is equivalent to the intended setup. The only difference is that role instructions travel inside each prompt instead of the agent definition. No product impact.

---

## ADR-002 — Differentiators for v1: A, C, E (plus F baseline)

**Date:** 2026-10-20
**Status:** accepted

**Context.** Brief Section 2 requires exactly three differentiators, F ships regardless, default preference A, C, E. The builder's brainstorm (`docs/BRAINSTORM.md` Section 2) scored A–G and proposed H–K. The director's critique (Section 5) adjusted several scores.

**Decision.** Ship **A (claim retraction via Wayback), C (regulator rulings: UK ASA and France JDP), E (ownership & repair)**, with **F (claim-language engine)** as baseline. Post-critique scores (value / feasibility / data / legal):

- A 5 / 3 / 3 (build 1) / 2
- C 5 / 3 / 3 / 2
- E 3 / 3 / 3 / 2
- F 4 / 5 / 5 / 2 (baseline)
- H 4 / 4 / 4 / 2 — strongest challenger, but it is an extension of F (same pages, same mechanism) and produces no independent receipt source; it ships **inside F** (same-page substantiation proximity), so it costs no slot.
- B 4 / 1 / 2 / 2, D 4 / 2 / 1 / 3, G 3 / 2 / 2 / 2, I, K — struck for v1 (see BRAINSTORM Section 5.1 and `docs/LATER.md`).

The default is kept; no override reasoning is needed, but for the record: E is retained despite its value downgrade (4 → 3) because brief Section 4 reserves a 20% scoring axis for it and no other candidate can feed that axis.

**Consequences.** Phase 4 implements A only (no B). Phase 5 implements C (two adapters) and E; D is not implemented as a registry check. Evidence-axis inputs that need no registry (impact report present, absolute emissions figure present, supplier list present, labels claimed) are deterministic page rules implemented in Phase 3 alongside F.

---

## ADR-003 — Regulator countries for v1: United Kingdom (ASA) and France (JDP)

**Date:** 2026-10-20
**Status:** accepted

**Context.** Brief Section 2 C says "start with two countries, design for more". Probes from the build container: ASA `/search.html?q=<brand>` server-renders ruling links and ruling pages return 200; JDP `/avis/` lists decisions server-side. FTC listing is server-rendered but its full-text filter did not filter; ACM, Reclame Code and AGCM are reachable but their search paths are unknown.

**Decision.** Implement `asa-uk` and `jdp-fr` adapters behind a common `RegulatorAdapter` interface (`search(brand) → RulingCandidate[]`, `fetchRuling(url) → Ruling`). FTC, ACM, RCC, AGCM go to `docs/LATER.md`. Matching rule: a candidate is **scored** only if the normalised brand name appears in the ruling title or advertiser field; otherwise it is shown as "possible match, not scored". The ruled entity name is always shown verbatim.

**Consequences.** Coverage is limited to brands that advertised in the UK or France. The "What we could not check" section must say so for every report.

---

## ADR-004 — Stack: Next.js + TypeScript only, no Python service

**Date:** 2026-10-20
**Status:** accepted

**Context.** Brief Section 6 allows a small Python service only if scraping proves painful and it is justified in BRAINSTORM. The builder's probe shows every v1 source is plain HTTP returning HTML or JSON.

**Decision.** No Python service. `undici` for fetching, `cheerio` for HTML, `diff` for text diffs, `pdf-parse` only if a report PDF is fetched (not required for any v1 signal). No headless rendering in the pipeline; JS-only pages are reported as "skipped: page requires JavaScript".

**Consequences.** G (intensity-vs-absolute, which would need PDF tables) stays out of v1.

---

## ADR-005 — SQLite driver: Drizzle + better-sqlite3

**Date:** 2026-10-20
**Status:** accepted

**Context.** Brief Section 6 specifies SQLite via Drizzle. The container has Node 22.22, g++/make, and reaches GitHub releases for prebuilt binaries. `node:sqlite` also works but is experimental and not supported by Drizzle.

**Decision.** `better-sqlite3` with Drizzle ORM, single file `data/greenwash.db` (path configurable via `GR_DB_PATH`), WAL mode. Tests use a temp DB file per suite. Schema migrations are applied at startup with `drizzle-kit`-generated SQL or an idempotent `CREATE TABLE IF NOT EXISTS` bootstrap; the builder chooses and documents it.

**Consequences.** If `better-sqlite3` fails to install in the container, the builder files `docs/CHALLENGES.md` and the director rules on a fallback (`node:sqlite` behind the same repository interface). The rest of the code must not import the driver directly: all DB access goes through `src/lib/db/`.

---

## ADR-006 — Offline testing: fixtures for three brands, injectable fetcher, mocked LLM

**Date:** 2026-10-20
**Status:** accepted

**Context.** Wayback is unreachable from the build container; Wikidata rate-limits the shared egress IP; `ANTHROPIC_API_KEY` is absent. The DoD requires `npm test` and the Playwright flow to pass.

**Decision.**
- Every module that performs I/O receives a `Fetcher` (`(url, opts) → Response-like`) and an `LLMClient` by dependency injection. Production wires `undici` + the Anthropic SDK; tests wire `FixtureFetcher` and `MockLLM`.
- Fixtures live in `fixtures/brands/<slug>/` for exactly three brands: one outdoor apparel, one electronics, one food. Where the live site is reachable from the container, the builder saves real HTML; where it is not, the builder hand-writes realistic HTML and marks the file with an HTML comment `<!-- synthetic fixture -->`. Wayback snapshot fixtures are hand-built by construction and must include at least one brand with a known removed claim.
- With `GR_OFFLINE_FIXTURES=1` the running app routes all fetches to the fixture fetcher and the LLM to the mock, so Playwright runs offline.
- `MockLLM` returns recorded JSON from `fixtures/llm/<name>.json`, keyed by call name and a hash of the input; an unrecorded call returns an empty valid result, never throws.

**Consequences.** The real-brand end-to-end check of DoD item 3 is "deferred: no API key" unless a key appears. The live Wayback path is "deferred: unreachable in build env" and recorded in `docs/LIMITATIONS.md`.

---

## ADR-007 — AI share definition and 50% guard

**Date:** 2026-10-20
**Status:** accepted

**Context.** Brief Section 4 caps LLM influence at 50% of the score and requires a test that fails if `ai_share` can exceed 0.5 for any input.

**Decision.**
- Each `Signal` carries `llm_used: boolean`. `ai_share = points_from_llm_signals / total_points` over the weighted points that actually enter the score (missing axes contribute 0 points and do not count).
- Guard rule in the scorer, documented in METHODOLOGY: if LLM-derived points would exceed non-LLM points, LLM-derived points are scaled down to equal the non-LLM points, so `ai_share ≤ 0.5` by construction. If there are no non-LLM points at all, LLM signals contribute 0 to the score (they are still listed as signals with receipts) and `ai_share = 0`.
- The LLM is only ever allowed to touch: candidate claim sentences (rules decide), diff classification (removed vs redesign), and the summary text. It never emits a number that enters the score.

**Consequences.** A property test with randomised signal sets (including all-LLM sets) asserts the bound; it is part of `npm test`.

---

## ADR-008 — Legal wording rules

**Date:** 2026-10-20
**Status:** accepted

**Context.** Brief Section 1 "signals, not verdicts". No human is available to vet copy.

**Decision.** A single file `src/lib/copy/wording.ts` holds every user-facing signal template. Allowed vocabulary: "risk signal", "unsupported claim", "claim removed between X and Y", "no supporting data found on the fetched page", "ruling found naming <entity verbatim>", "label claimed on page; not verified in v1", "not found", "skipped: <reason>". Forbidden anywhere in UI, summary prompt or docs: "lies", "lying", "guilty", "illegal", "non-compliant", "fraud", "deceptive" (as a verdict), "greenwashing" used as a verdict about a named brand (the product name and the phrase "greenwashing risk signals" are fine). A unit test scans `src/` and the rendered report fixture for the forbidden list. The LLM summary passes through the same filter before display.

**Consequences.** Copy changes are reviewed by the test, not by a human.

---

## ADR-009 — Confident Wikidata match auto-proceeds; the confirm card is shown only when the match is not confident

**Date:** 2026-10-20
**Status:** accepted

**Context.** Brief Section 7 describes the Phase 1 done-when as "patagonia → confirm card → proceeds", while Section 3.2 says that a result scoring clearly above the rest (exact-name match + website + company) proceeds without a card, and Section 1 makes disambiguation mandatory only when the match is *not* confident. The recorded fixture makes Patagonia, Inc. (Q1660552) the single confident match. The builder auto-proceeds for "patagonia" and proves the card path with "continental" (Continental AG vs United Airlines).

**Decision.** Section 3.2 is normative; Section 7's phrase is an illustrative test description. Confident ⇔ exactly one eligible (brand/company/organisation) item has an exact normalised-name match and a website. A confident match proceeds; anything else shows ≤ 3 cards; no candidates or all rejected ⇒ URL fallback. The pipeline is never run on an unconfirmed match (1.8). The e2e test for 1.6 keeps the card branch so it still passes if the fixture stops being confident.

**Consequences.** Phase 1 passes on this point. Any future change to the confident rule needs a new ADR and a fixture that exercises both branches.

---

## ADR-010 — robots.txt is enforced for crawled pages, not for the brief-mandated API endpoints

**Date:** 2026-10-20
**Status:** accepted

**Context.** Brief Section 1 requires respecting robots.txt. `https://www.wikidata.org/robots.txt` (checked by the director 2026-10-20) contains `User-agent: *` / `Disallow: /w/`, which covers `/w/api.php`, the endpoint Section 3.2 instructs us to call. The Wayback CDX and `id_` raw-snapshot endpoints of Section 5 are likewise API-style endpoints that robots.txt was not written to govern.

**Decision.** `RobotsGuardedFetcher` is mandatory for every page fetched from a brand site, a regulator site or a repair source (Phases 2, 4 page content, 5). It is **not** applied to the three API endpoints the brief itself mandates: the Wikidata `api.php`, the Wayback CDX API and Wayback snapshot retrieval. For those we follow the operator's published API etiquette instead: descriptive User-Agent, `Retry-After`-aware retry, SQLite caching, and the ≤ 1 req/s limit for `web.archive.org`. The exemption list is exactly these hosts' API paths; it is not extended without a new ADR.

**Consequences.** `docs/LIMITATIONS.md` (Phase 9) states the exemption and its reasoning. The Phase 2 review checks that every non-API fetch goes through the robots guard and that a disallowed page appears as `skipped: robots.txt disallows <url>` and is served from Wayback where available (brief Section 8).

---

## ADR-011 — Synthetic fixtures never impersonate a real brand

**Date:** 2026-10-20
**Status:** accepted

**Context.** patagonia.com bot-blocks the build container (every request, including `/robots.txt`, returns a "Hang Tight!" page). The builder hand-wrote a Patagonia fixture under real `www.patagonia.com` URLs and the real Wikidata entity Q1660552, with invented claim sentences, relying on ADR-006's "otherwise synthetic, marked" clause. In offline mode and in every later test that fixture would produce receipts (source URL + excerpt) for text the brand never published, under the brand's own name. Brief Section 1 (receipt = real fetch), Section 8 (no wording about a brand that is not in a receipt) and Section 6 ("real saved HTML of 3 brands") all point the same way. The director verified today that other outdoor-apparel brands are reachable (Mammut, VAUDE), so a real capture is executable.

**Decision.** The three fixture brands are real captures. A synthetic fixture is allowed only for a fictional brand under a reserved domain (`.example`, `.test` or `.invalid`), with no real Wikidata id and no real company name, and is used for rule and edge-case tests only. A unit test enforces this for every `fixtures/brands/*/meta.json`. The same rule applies to Wayback snapshot fixtures (Phase 4): hand-built snapshots belong to the fictional brand; a real brand's timeline comes only from recorded CDX/`id_` responses. If a real site is unreachable, the brand is replaced, not imitated. Patagonia's Wikidata fixtures stay for the Phase 1 disambiguation tests; offline, a Patagonia run honestly ends with `skipped: no page could be fetched …`.

**Consequences.** Phase 2 rework: Patagonia fixture re-homed to a fictional brand; Mammut or VAUDE recorded as the outdoor-apparel brand. ADR-006's synthetic clause is narrowed accordingly.

**Outcome (round-2 review, 2026-10-20).** Mammut (Q495318, query "mammut sports group", 12 real pages captured 2026-10-20T22:56Z) is the outdoor-apparel brand. The synthetic fixture is `northwind` (Northwind Outdoor Ltd., `www.northwind-outdoor.example`, no Wikidata id). The guard test `tests/unit/fetch/brand-fixtures.test.ts` enforces this ADR. PLAN.md's fixture-brand line was renamed accordingly (not a re-plan).

---

## ADR-012 — robots.txt unreachable or malformed ⇒ do not crawl (fail closed)

**Date:** 2026-10-20
**Status:** accepted

**Context.** `RobotsChecker` treated a 5xx, a network error, or a 2xx HTML bot-wall page as "no rules", i.e. allowed everything. RFC 9309 §2.3.1.4 says an unreachable robots.txt (5xx, network failure) must be treated as complete disallow; §2.3.1.3 says 4xx means no restrictions. A bot wall served with 200 is not a robots file and gives no permission.

**Decision.** 4xx ⇒ allowed. 5xx, network error, or a 2xx body that is HTML (content type `text/html` or body starting with `<`) ⇒ the whole origin is disallowed for this run with the shown reason `robots.txt unavailable for <origin> (<cause>)`. A cached robots.txt from SQLite is used when the live fetch fails and a copy exists. The brief-mandated API endpoints (ADR-010) are unaffected.

**Consequences.** Some sites will be skipped with a visible reason instead of crawled; Wayback (Phase 4) is the fallback, as brief Section 8 already prescribes.

**Amendment (round-2 review, 2026-10-20).** Implemented in Phase 2 rework except the "cached robots.txt used when the live fetch fails" clause: the Phase 1 cached fetcher serves a fresh cache entry before any live request but does not serve a stale entry on failure. Deferred to Phase 8 (cache/stale handling) and recorded in docs/LATER.md; until then an unreadable robots.txt costs coverage, never honesty, because the skip is shown.

---

## ADR-013 — Run lifecycle: a GET may create a pending run row, but a run can never sit in `running` without a process executing it

**Date:** 2026-10-20
**Status:** accepted

**Context.** Two Phase 2 observations. (1) The confident auto-proceed on `GET /confirm?q=…` creates a `runs` row before redirecting; nothing is fetched until the explicit POST `startRun` action claims the run (`pending → running`, atomic). (2) A run whose process dies mid-pipeline stays `running` forever and the analyse page shows "running…" indefinitely.

**Decision.** (1) Accepted for v1: the side effect is a database row with no fetching; Phase 8 serves a cached report for an already-analysed brand, which removes the duplicate rows in practice. (2) Not accepted: a hung `running` state hides a failure, and the brief requires failures to appear as `skipped: <reason>`. When the run view is built and the run is `running` but no in-flight pipeline exists in this process, the run is marked `failed` and the running step becomes `skipped: analysis interrupted (server restarted); search again to retry`. Resume is out of scope for v1 (`docs/LATER.md`); the single-process assumption is documented in `docs/LIMITATIONS.md` in Phase 9.

**Consequences.** Phase 2 rework item 3 implements (2) with a unit test. No change for (1).

## ADR-014 — Substantiation markers: a year alone is not evidence, and a target is never its own evidence (ruling on CHALLENGES C-1)

**Date:** 2026-10-20
**Status:** accepted

**Context.** PLAN Phase 3 deliverable 2 listed "a year" as a same-page substantiation marker. The builder implemented it as written and raised C-1: on the fictional fixture, "We are carbon neutral." is marked `claim.supported` because the two following sentences are *targets* ("net zero … by 2040", "cut … by 2030"). The director reproduced it and found the same defect wider than C-1: "Founded in 1998, we make gear." and "Shop the 2025 collection." substantiate a vague claim; "We are committed to 100% renewable electricity." is marked supported by its own target figure (the `future_only` rule only blanks the trigger phrase "committed to"); "We will be a sustainable company by 2030." marks the vague hit supported by the target year of the sentence. Brief Section 2 F asks for offset language "without reduction data" and future commitments "without progress data"; a date, a collection year or a target figure is neither.

**Decision.**
1. A year is never a marker on its own. It is recorded only alongside a number + unit marker in the same sentence of the window (for display), and never when it is preceded by a target preposition (by, until, till, before, no later than, towards, toward, ahead of).
2. A sentence in the window that itself matches the `future_only` rule is a target and contributes no marker of any kind.
3. For a `future_only` hit, the matched sentence contributes no number + unit marker: the rule has already established that the figure sits next to no progress cue, so it is the target figure.
4. The other markers stand: number + unit, a named standard or certifier, an evidence link. The claim's own trigger spans are blanked first (builder's addition, accepted).

PLAN Phase 3 deliverable 2 is amended to this wording and criterion 3.2 gains the cases above. This is a ruling on a builder challenge that narrows one definition; phases, scope and the acceptance-test set are unchanged, so it is not counted as one of the two re-plans (count stays 0 of 2). The verdict on Phase 3 round 1 is REWORK and the fix is item 1 of that list.

**Consequences.** More hits become `claim.unsupported`; per-1,000-word match counts (the claims-axis input) do not change. "Carbon neutral since 2019" with no figure is unsupported: a date is not reduction data. `docs/METHODOLOGY.md` Section 3 and the `claim.supported` label must say the same thing.

## ADR-015 — Phase 3 builder additions accepted; known false positives on quoted or third-party text are a documented limit

**Date:** 2026-10-20
**Status:** accepted

**Context.** The Phase 3 builder went beyond the plan in five places and listed the noise it saw on real pages (docs/phases/3.md). No human is available to approve either.

**Decision.**
- `claim.supported` kind: accepted. A substantiated hit still has a receipt and is still a risk signal; the family rate in `ClaimStats` stays the claims-axis input (brief Section 4). Phase 6 must give `claim.supported` strictly fewer points per signal than `claim.unsupported` in `config/weights.json` and the label must not read as a verdict either way.
- Trigger-phrase blanking before substantiation: accepted and required (ADR-014 item 4).
- Questions never match: accepted; a question asserts nothing. Rhetorical questions followed by an answer are caught by the answer sentence.
- `weight_hint: 1` placeholder (`DEFAULT_WEIGHT_HINT`): accepted until Phase 6, when every weight lives in `config/weights.json` and no number in `src/lib/claims` or `src/lib/score` may decide points.
- Lexicon narrowing found on real pages ("will" needs a subject form, "greener/cleaner" need a noun, "we plan to"): accepted; it reduces grammar-only hits.
- Quoted, critical or advocacy text (Oatly's food-policy essay, Mammut's paragraph critical of carbon-neutrality marketing) matching a rule: accepted as a documented limit (METHODOLOGY Section 7). Every match ships with its sentence, so a reader can judge it; detecting quotation or stance deterministically is out of scope for v1 and goes to `docs/LATER.md`.
- Third-party statistics matching `future_only` ("By 2050, an estimated 120 million tons of e-waste will be generated"): **not accepted**. The brief's F asks for future-tense *commitments*. When the only trigger is "by 20XX", the sentence must also carry a commitment subject (we, our, us, the company, the brand name from the run) to match. Rework item 2 of Phase 3.

**Consequences.** Logged for Phase 6 (points per kind) and Phase 9 (LIMITATIONS).

---

## ADR-016 — Archived copies of robots-disallowed pages are diffed for the timeline, not scored as current claims

**Date:** 2026-10-20 (Phase 4 review)
**Status:** accepted

**Context.** Brief Section 8: "Scraping sites that forbid it in robots.txt: rely on Wayback for those and say so." Phase 4 pulls the Wayback history of robots-disallowed sustainability-type pages first (they are never fetched live) and diffs it for `claim.removed` signals, but the claim-language engine (axis: claims) only scores pages fetched live. The question was whether the newest archived copy should be scored as if it were the live page.

**Decision.** No. An archived copy can be years old; scoring it on the claims axis would present text the brand may since have changed as its current wording, with a receipt that does not support "current" (brief Sections 1 and 8: no wording about a brand that is not in a receipt). The archive is used for what it proves — what the page said on dated occasions — so the history is diffed, the claims present in each archived copy are listed in the timeline with their `id_` receipts and capture dates, and removals are scored on the track-record axis. The "What we could not check" line for such a page must say that its archived copies were read instead (or that none were found, or that the archive was unreachable); this is Phase 4 rework item 2.

**Consequences.** Brands that block crawling get a timeline and removed-claim signals but no claim-language score for the blocked pages; this is stated per page in the report. Logged in `docs/LIMITATIONS.md` by the Phase 4 rework.

---

## ADR-017 — Newest snapshot vs live page moves into Phase 7; criterion 7.6 names the fictional removed-claim brand

**Date:** 2026-10-20 (Phase 4 review)
**Status:** accepted

**Context.** Phase 4 deliverable 3 compares consecutive archived snapshots only. With `collapse=timestamp:4` the archive returns the *first* capture of each year, so a claim removed at any point after January of the current year is not visible until the following year: the most recent removals, the ones that matter most for differentiator A, are missed. The live page text is already fetched (`ctx.pages`), and `detectRetractions` works on any ordered sequence of texts. The builder put this in `docs/LATER.md`; the director rules it is v1 scope.

Separately, PLAN Phase 7 criterion 7.6 asked for `ai_share > 0` "for at least the removed-claim brand" among "all three fixture brands". The removed-claim brand is the fictional Northwind (ADR-011), and the three real fixture brands have no recorded Wayback history (`docs/LIMITATIONS.md`), so as written 7.6 could not be met.

**Decision.** PLAN Phase 7 gains deliverable 8 and criterion 7.8: for every page that was fetched live and has at least one archived snapshot, the live page is the final element of the sequence (its entry in the timeline is marked as the live page, year = current year, URL = the page URL); a claim present in the newest snapshot and absent from the live page yields `claim.removed` with the label "claim removed between <year> and the current page", receipt = the newest snapshot's `id_` URL, and a diff candidate for the classifier. Criterion 7.6 is reworded to "the three real fixture brands plus Northwind; > 0 for Northwind". These are edits to a phase that has not started, in the same class as the fixture-brand rename recorded under ADR-011; they are not a re-plan of a reviewed phase (re-plans used: 0/2).

**Consequences.** Phase 7 is slightly larger. The Phase 4 rework does not touch this. `docs/LATER.md`'s "newest snapshot vs live page" row is to be removed by the Phase 7 builder; the "record real-brand histories" half of that row stays.

---

## ADR-018 — iFixit is read through the robots-allowed device-category endpoint, not the search API (ruling on CHALLENGES C-2)

**Date:** 2026-10-21 (Phase 5 review)
**Status:** accepted

**Context.** PLAN Phase 5 deliverable 5 named `GET https://www.ifixit.com/api/2.0/search/<brand>?filter=device`. The recorded `https://www.ifixit.com/robots.txt` (`fixtures/sources/robots/www-ifixit-com.txt`, 2026-10-20) has `Disallow: /api/*` for `User-agent: *` with explicit `Allow` only for `/api/2.0/categories*`, `/api/2.0/guides*` and `/api/2.0/wikis*`. ADR-010 keeps every repair source under the robots guard and allows no exemption without a new ADR. As planned, the step would always end `skipped: robots.txt disallows …` and criterion 5.6 could not be met by a real capture. Brief Section 8: do not scrape what robots.txt forbids.

**Decision.** The plan's intent (iFixit data, receipted, through the API) is kept and its endpoint is replaced: the brand's device category is read from `/api/2.0/wikis/CATEGORY/<brand>` and at most `maxDevices` of its device sub-categories (guide titles, repairability score), `config/repair.json`. The category title must equal the brand after the Section 9.5 normalisation, otherwise nothing is attributed. The search endpoint is never requested and a test pins that every `/api/` call is under `/api/2.0/wikis/CATEGORY/`. The ADR-010 exemption list is unchanged. PLAN deliverable 5 is corrected to this endpoint (wording only; criterion 5.6 untouched).

**Consequences.** A brand whose iFixit category is named differently from the brand gets no iFixit signal and the report says so (`docs/LIMITATIONS.md`). A name lookup through the allowed `/api/2.0/categories` tree stays in `docs/LATER.md`. Phase 6 note: iFixit guides are community-written, so `repair.ifixit_guides` says that repair information exists for the product, not that the brand provides it; its points must stay below those of `repair.manual_found` / `repair.spare_parts_found`, and `repair.ifixit_score` (iFixit's own published score) carries the iFixit weight.

---

## ADR-019 — A ruling is scored only when the ruled entity's name equals the brand's after normalisation; a whole-word occurrence is "possible", never scored (ruling on CHALLENGES C-3)

**Date:** 2026-10-21 (Phase 5 review)
**Status:** accepted; refines ADR-003

**Context.** PLAN Phase 5 deliverable 3 said `scored` when the normalised brand is a whole-word match in title or advertiser, else `possible`. Criterion 5.3 of the same phase requires "Patagonia" vs "Patagonia Provisions Ltd" ⇒ `possible` and "Pata" vs "Patagonia" ⇒ no match, which the deliverable's two-way rule cannot produce. ADR-003 said "appears in", which has the same looseness. The brief's rule is that no fact is stated about a brand without a receipt naming it; a ruling against "Shell Energy UK" is not a receipt about "Shell".

**Decision.** The criterion wins. Three-way rule, as implemented in `src/lib/regulators/match.ts` and METHODOLOGY 9.5: **scored** = one of the advertiser's names (split on "t/a" / "trading as"; title when there is no advertiser field) equals the brand after normalisation (lowercase, diacritics, punctuation, "&", trailing legal suffixes from `config/wikidata.json`, trailing geographic/structural qualifiers from `config/regulators.json`; spacing ignored); **possible** = whole-word occurrence otherwise, shown under "What we could not check" with the entity verbatim, `scored: false`, never a signal; **none** = anything else. Documented outcome for the 5.3 open case: "Shell" vs "Shell Energy Retail" ⇒ `possible`. ADR-003's matching sentence is superseded by this one. PLAN deliverable 3 is corrected to this wording (criterion 5.3 untouched). The qualifier list is deliberately short; a subsidiary with extra words in its name is a possible match, and that is the documented price of never attaching a ruling on a fuzzy name (`docs/LIMITATIONS.md`).

**Consequences.** Fewer rulings are scored than a looser rule would score; none is scored against the wrong entity. Phase 8 must render possible matches with the entity name verbatim and the "not scored" wording of `couldNotCheck.regulatorPossible`, never in the receipts list of the track axis. Not a re-plan: no criterion, scope or phase changed; two deliverable sentences now say what their criteria already required (same class as ADR-014).

---

## ADR-020 — Points are risk points only; protective kinds carry 0 and lower a sub-score by replacing the risk kind (ruling on CHALLENGES C-4)

**Date:** 2026-10-21 (Phase 6 review)
**Status:** accepted; refines the Phase 3 and Phase 5 review notes and the ADR-018 Phase 6 note

**Context.** Two carry-forwards said that protective kinds (`evidence.report_found`, `report_found_undated`, `absolute_emissions_found`, `supplier_list_found`; the repair findings) "lower the sub-score", and ADR-018 asked for `repair.ifixit_guides` to carry fewer points than `repair.manual_found` / `spare_parts_found`. PLAN criterion 6.2 and brief Section 4 require that removing any signal never raises the score. A signal that subtracts when present raises the score when removed; the two readings cannot both hold literally (`docs/CHALLENGES.md` C-4).

**Decision.** Criterion 6.2 and the brief win, as the builder implemented: every kind's points are ≥ 0 (schema-enforced in `src/lib/score/weights.ts`), protective kinds carry 0 points, and a protective finding lowers a sub-score only by taking the place of the risk kind the rules emit when nothing is found (`report_found` instead of `no_report_found` / `stale_report`; any repair finding instead of `no_repair_info_found`). The ADR-018 ordering is read as "not above": `ifixit_guides` 0 ≤ `manual_found` 0 ≤ `spare_parts_found` 0, pinned in `tests/unit/score/scorer.test.ts`. Protective signals keep their receipts, are listed, and count as data for confidence. Consequence accepted for v1: `absolute_emissions_found` and `supplier_list_found` do not move the score, and a brand with only community (iFixit) repair information scores the same on the repair axis as one that publishes its own manual. The builder's option (explicit, receipted absence kinds such as `evidence.no_absolute_emissions_found` and `repair.no_brand_repair_info_found` with points in `config/weights.json`) is the right way to make those inputs count; it changes Phase 3/5 rules and the pinned fixture scores, so it goes to `docs/LATER.md`, not into a re-plan (re-plans used: 0/2).

**Consequences.** `docs/METHODOLOGY.md` Section 11 item 3 and `docs/LIMITATIONS.md` "Score and confidence" already state this. Phase 8 must show protective signals in the axis receipts list with their 0 points, not hide them. The C-4 entry in `docs/CHALLENGES.md` is closed by this ADR.

## ADR-021 — Temperature 0 only where the model accepts it; hand-authored LLM stand-ins are allowed until a key exists; LLM answers are not a cached "fetch" (ruling on CHALLENGES C-5, Phase 7 review)

**Date:** 2026-10-21 (Phase 7 review)
**Status:** accepted

**Context.** Brief Section 5 asks for Anthropic tool-use with temperature 0. The builder reports (C-5) that the current models reject non-default sampling parameters and forced tool choice. The director checked this against the current Anthropic API reference: Claude Sonnet 5.5, Opus 5.5 and Haiku 5.5 return HTTP 400 for non-default `temperature`/`top_p`/`top_k` and for `tool_choice` `any`/`tool`; Haiku 4.5, Sonnet 4.6 and Opus 4.6 accept `temperature`. Separately, no `ANTHROPIC_API_KEY` exists in the build environment, so the "recorded JSON fixtures" of brief Section 6 cannot be recorded; and the brief's cache rule (Section 1) says every external fetch is cached in SQLite.

**Decision.**
1. The default model stays `claude-sonnet-5-5` (overridable with `GR_LLM_MODEL`). `temperature: 0` remains in `config/llm.json` and is sent to every model listed in `temperatureModels` (the three models known to accept it); for models that reject it, determinism is pursued through a `strict: true` tool with `additionalProperties: false`, `tool_choice: auto` with `disable_parallel_tool_use`, item-wise schema validation (invalid items dropped, invalid payloads rejected), the rule engine deciding every claim, and recorded fixtures for tests. Downgrading to an older model to satisfy the parameter is rejected. `docs/METHODOLOGY.md` Section 12 and `docs/LIMITATIONS.md` state the deviation.
2. Hand-authored LLM fixtures are permitted as stand-ins while no key is available, under three conditions that are all met: each file's `source` says it is not model output (test-enforced), the stand-ins cannot introduce text about a real brand that is not verbatim in a real captured page (extraction) or already a receipt in the report (summary), and `docs/LATER.md` requires re-recording with `GR_RECORD_LLM=1` once a key exists. This does not widen ADR-011: a stand-in is never a receipt.
3. LLM answers are not an external fetch in the sense of brief Section 1: they are not re-served, rate-limited or robots-guarded resources, and the < 1 s re-serve requirement is met by the stored report. An LLM answer cache stays in `docs/LATER.md`.

**Consequences.** Phase 7 passes. Phase 8 must author or record the summary fixture for the Northwind URL-fallback input so the offline Playwright flow shows a summary on the report page. The final review lists the real-brand end-to-end check as "deferred: no API key" unless a key appears.

## ADR-022 — A stored report is re-served only for the same website and the same Wikidata entity (or the same typed name for a pasted website) (Phase 8 review)

**Date:** 2026-10-21 (Phase 8 review)
**Status:** accepted

**Context.** PLAN Phase 8 deliverable 2 says a new search "for a brand" with a report younger than `GR_REPORT_TTL_HOURS` is redirected to the existing report. The builder first keyed the cache on the website alone and found that a URL-fallback report made under the typed name "acme" was re-served to a Wikidata search for "oatly" on the same website, so the page would carry the wrong brand name and no entity. The builder narrowed the key: website (spellings with and without a trailing slash count as one) **and** the confirmed Wikidata entity; for a pasted website with no entity, website **and** the typed name (case-insensitive). `ReportsRepo.findFresh` joins `runs` for the entity; `tests/unit/db/report-cache.test.ts` and `tests/e2e/cache.spec.ts` pin both halves.

**Decision.** Accepted as the reading of "a brand" the plan intended. The brief's requirement (Section 1: a known brand re-served from cache in under a second; Section 3.4: a cached shareable link) is about the same brand, and a report that names another brand is not that brand's report. The stricter key costs at most one extra pipeline run when the same website is reached under a different identity, which is the honest outcome. `docs/LIMITATIONS.md` states the rule. The `x-gr-served-from: cache` route header is accepted as truthful rather than measured: both routes only ever read the stored `ReportV1`; the sub-second re-serve is measured in tests (8.5) and by the director (prod, ~30 ms).

**Consequences.** No change to PLAN.md. "Re-run the analysis" remains the only way to force a new run for an identity with a fresh report. E2E helpers press "Re-run" when a search is re-served, which mirrors a user and keeps the tests independent of run order.

## ADR-023 — Phase 9 rulings: unused `stepError` template, `signals` table, production cache timing, deferred key item, `npm audit`

**Date:** 2026-10-21 (Phase 9 review)
**Status:** accepted

**Context.** The Phase 9 builder note raised five points the director had to rule on with no human available (brief Section 0.4): (a) `reasons.stepError` in `wording.ts` is defined but a step that throws shows `skipped: <error message>` instead; (b) the `signals` table is created but never read or written; (c) the live Fairphone run re-served from cache in 27–45 ms on `next start` but over 1 s on `next dev`; (d) no `ANTHROPIC_API_KEY` exists, so the real-brand-with-key DoD item cannot be run; (e) `npm audit --omit=dev` reports two findings in the `postcss` bundled by `next` 15.5, fixable only by `next` 16.

**Decision.**
1. (a) is not a defect. Brief Section 3.3 requires a failed step to be shown as "skipped: reason" and never hidden; the catch block does exactly that with the error's message as the reason. The unused template is recorded in LIMITATIONS (guarded by test 9.4) and in LATER as a cosmetic wiring.
2. (b) keep the table, documented in `schema.ts` and LIMITATIONS. Removing a planned deliverable in the last phase buys nothing.
3. (c) the "< 1 s from cache" requirement is judged on the production server (`next start`), the way the app is served; dev-mode compilation latency is not the app's cache path. Test 8.5 pins the path offline; the live measurement is in `docs/phases/9-real-run.json`.
4. (d) "deferred: no API key", per brief Section 6 and 10. The live half was done without a key (Fairphone, 24 receipted signals, score 3, ai_share 0) and is reported as such, not as the DoD item being met.
5. (e) accepted as a documented limitation: the app renders no user-supplied CSS, the vulnerable code runs in the build toolchain, and a `next` 16 migration is a breaking change outside v1 scope. Logged in LATER.

**Consequences.** Phase 9 passes with 0 rework rounds. FINAL-REVIEW lists the deferred item and the command that completes it. Totals for the run: rework rounds 3 (Phases 2, 3, 4, one each), re-plans 0 of 2.

---

# v1.1 decisions

## ADR-024 — v1.1 run: native agents loaded, ADR-001 fallback ends; hard-limit counters restart

**Date:** 2026-10-21
**Status:** accepted; supersedes ADR-001 for this and later runs

**Context.** v1 merged (PR #1). The session that starts v1.1 has the `director` and `builder` agent types loaded natively from `.claude/agents/`, so the ADR-001 fallback (built-in agent with pasted role content) no longer applies. The human asked for v1.1 ("trusted external greenwashing sources, implement everything") and will not answer questions.

**Decision.** From this entry on, the orchestrator calls the native `director` (claude-fable-5-1, effort medium) and `builder` (claude-opus-5-5) agents; role boundaries unchanged (director writes only under `docs/`; builder never changes scope, weights or differentiators, and files `docs/CHALLENGES.md` to disagree). v1.1 is a new run under brief Section 0.4: counters restart (max 3 rework rounds per phase, max 2 re-plans). Phases 10–15 are appended to `docs/PLAN.md`; source triage lives in `docs/SOURCES.md`.

**Consequences.** No product impact. `docs/FINAL-REVIEW-v1.1.md` (Phase 15) records the v1.1 counters.

---

## ADR-025 — Validation set first; ground-truth labels are evaluation-only and isolated from the score

**Date:** 2026-10-21
**Status:** accepted

**Context.** The human asked for a ground-truth list of ~20 flagged and ~20 well-rated brands with a citation each, and a harness that reports whether scores separate the groups. The most important v1 weakness ("saying less scores better") can only be judged with such a harness. Risk: a label list in the repository could leak into the score (directly, or by tuning weights against it), which would turn an evidence-based score into a reputation lookup.

**Decision.**
1. Phase 10 ships before any new source. The harness (`npm run validate`) runs the real pipeline per brand and reports AUC (Mann–Whitney), mean/median difference, per-axis AUC and a Spearman diagnostic (score vs words scanned, score vs claim-sentence count). Offline mode runs the ground-truth brands that have fixtures in CI; live mode is run from the container where the network allows and committed as a dated results file, honestly labelled partial.
2. `fixtures/validation/ground-truth.json` carries `label_use: "evaluation_only"`. It is read only by `src/lib/validation/**`, which is imported only by `scripts/validate.ts` and tests (criterion 10.4, import-graph test). METHODOLOGY says labels never enter the score. Weights are never fitted to the labels: any weight change in v1.1 is a director's value stated in PLAN before the measurement, and the harness result is reported, not optimised.
3. "Well-rated" is defined as "no credible flag found after checking every flagged source, plus two positive markers" (SOURCES.md). It is a weak label and is documented as such. Brands with both a flag and strong positive markers go to `contested` and are excluded from the statistic.
4. Overlap between ground-truth sources and pipeline sources (ASA, JDP, and later SBTi and Sabin) is allowed but measured: RESULTS.md reports how many flagged entries are flagged only by a source the pipeline queries (the leakage line, criterion 10.6).

**Consequences.** Phases 11–13 each re-run the harness so the effect of each source is visible; Phase 14 uses it to decide the claims formula. The v1 fixture brands stay; Oatly already qualifies as flagged via its recorded ASA ruling. The fictional brands never enter the ground truth.

---

## ADR-026 — SBTi "Commitment Removed" is a scored track-record signal; targets set are protective (0 points); export parsed with `exceljs`

**Date:** 2026-10-21
**Status:** accepted

**Context.** Probed today: the dashboard HTML is paginated (33 rows per htmx page), but `companies-excel.xlsx` is a public, complete export (15,816 rows, `last-modified` 2026-10-15) with explicit status fields and a `status_reason`. SBTi's terms allow storing and citing the data for non-commercial use with credit and a link. SBTi publishes no history, so a removed commitment is only visible while it is in the export. Reading `.xlsx` needs a parser; `exceljs` (MIT) is on the npm registry, no account.

**Decision.** `sbti.commitment_removed` (track axis, director's points 15, below `regulator.ruling` 25 and below `claim.removed` 20: an expired commitment is weaker evidence than a removed claim or a ruling) when `near_term_status` or `net_zero_status` is "Commitment Removed", unless `status_reason` is "Target set at parent company level" or "Company change" (then `sbti.status_note`, 0 points, listed: those are not the brand walking back). "Validated Targets" ⇒ `sbti.targets_validated` (0 points, protective per ADR-020, listed and counted as data); "Commitment to Set Targets" ⇒ `sbti.commitment_pending` (0 points). Matching by the ADR-019 equality rule on `company_name`, plus ISIN/LEI equality with the Wikidata entity when available. Every SBTi receipt carries the attribution line of SOURCES.md. Recency uses the existing `regulatorRuling.recentYears`/`recentMultiplier`. The full export is cached in SQLite with a 168 h TTL and recorded as a trimmed fixture (rows of fixture and ground-truth brands plus 50 random rows; full-file hash in the fixture README) so the repository does not carry 2.3 MB per capture. `exceljs` is the one new dependency of v1.1.

**Consequences.** `config/weights.json` becomes version 2 (Phase 11). METHODOLOGY 9b. LIMITATIONS: snapshot nature; a removal that SBTi later re-lists disappears from new reports but stays in stored ones with its fetch date.

---

## ADR-027 — French repairability index: scored on the repair axis only for openly licensed datasets; others are pointed to, never excerpted

**Date:** 2026-10-21
**Status:** accepted

**Context.** data.gouv.fr's API is reachable with retries (intermittent resets from this egress). 125 datasets match "indice de réparabilité"; of the 45 inspected, 41 carry `license: notspecified`, 3 Licence Ouverte 2.0 (including Fairphone), 1 public domain. The index is a mandatory disclosure under French law, but a dataset page with no licence grants nothing explicit, and brief Section 1 requires that every excerpt we show be something we may show.

**Decision.** Licence gate in `config/repair.json` (`frIndex.openLicences`: `lov2`, `etalab-2.0`, `other-open`, `other-pd`, `cc-by`, `odc-odbl`). Open ⇒ the newest CSV is fetched and the brand's rows (newest `date_calcul` per model) produce `repair.fr_index_found` (0 points, protective) or `repair.fr_index_low` (director's points 30; mean `note_ir` below 5.0 on the 0–10 scale) — both replace `repair.no_repair_info_found` (ADR-020). Not open ⇒ one "What we could not check" line with the dataset URL and "licence not specified", and the CSV is not fetched. Matching: organisation name or `nom_metteur_sur_le_marche` equals the brand after ADR-019 normalisation ("France", "SAS" etc. stripped by the existing lists). Non-durable brands: unchanged (not applicable).

**Consequences.** Coverage is the French market and, in practice, a handful of publishers until more datasets carry a licence; LIMITATIONS says so. The threshold 5.0 is a director's value chosen before measurement (the index's own colour scale turns from orange to yellow between 4 and 6); Phase 12's validation re-run reports its effect, and changing it needs an ADR.

---

## ADR-028 — Sabin climate litigation: document-page adapter with narrow, honest discovery; no private API, no `/_search`, no download form; a filed case is not a ruling

**Date:** 2026-10-21
**Status:** accepted

**Context.** climatecasechart.com is a Climate Policy Radar app. Observed: `/search?q=` renders results client-side from `app.climatepolicyradar.org/api/v1` using a token embedded in the page; `robots.txt` disallows `/_search`; geography pages server-render only the 4 newest families; document pages are fully server-rendered (`__NEXT_DATA__` with title, summary, dates, events, geographies); the full database is obtainable only by submitting a request form; the terms page is client-rendered and could not be read from the container; no open mirror exists. ADR-010 allows API use only for endpoints the brief itself mandates with published etiquette; using an app's embedded token is neither.

**Decision.** The adapter reads only `/document/<slug>` and `/geographies/<slug>` pages on `www.climatecasechart.com` (test-pinned, criterion 13.5). Discovery is the brand's country page plus the US page (4 newest families each) and a recorded, dated seed index of document URLs that the adapter re-fetches and re-matches live (never trusted as a label). The could-not-check list always states this coverage limit. Matching is the ADR-019 equality rule on parties parsed from the title; whole-word ⇒ possible, never scored. Signal `litigation.case` (director's points 10, strictly below `regulator.ruling` 25) with status multipliers from config: dismissed/withdrawn ⇒ 0 (listed, 0 points); pending/filed/decided/unknown ⇒ 1. The label says "a filed case is not a ruling". Requesting API access or the database download needs a human and goes to `docs/LATER.md`.

**Consequences.** Coverage is small and stated; the value of Phase 13 is a correct, receipted, status-aware case signal that grows the moment a sanctioned discovery path exists. Pre-authorised cut: the seed index (PLAN v1.1 hard limits).

---

## ADR-029 — Source triage for the remaining candidates

**Date:** 2026-10-21
**Status:** accepted

**Context.** The orchestrator's research listed further sources; the director probed each (SOURCES.md table).

**Decision.**
- **Changing Markets / greenwash.com:** ground truth only. Reachable and server-rendered, but an advocacy publication is an opinion, not a receipt about what the brand said; the pipeline's receipts must stay primary (brand pages, archives, regulators, registries).
- **NewClimate CCRM 2025:** ground truth only; 403 from the container, so citation-only with `verified_from_container: false`.
- **InfluenceMap:** LATER. Lobbying alignment is a fifth claim type with no axis, its scores are analyst judgements, and no open licence was found.
- **Fashion Transparency Index:** weak positive marker only; never a flag, never a signal (transparency is not truthfulness).
- **Net Zero Tracker:** ground truth only (CC BY-NC 4.0); a signal only with written permission (LATER).
- **Zero Greenwashing Alliance:** rejected (no structured data). **Truth in Advertising:** rejected as data; may support a citation's "why" when it links a primary action. **EU CPC 2021 sweep:** methodology support only (base rate, no brand names). **Good On You and commercial trackers:** rejected (opaque or paid). **B Corp:** unchanged (LATER; blocked).

**Consequences.** Nothing in this list touches the score. SOURCES.md is the register; a new source needs a row there and an ADR before a builder touches it.

---

## ADR-030 — "Saying less scores better": implement a share-based claims formula behind a config switch, measure before and after, decide at the Phase 14 review

**Date:** 2026-10-21
**Status:** accepted (decision on adoption deferred to ADR-032 at the Phase 14 review)

**Context.** The v1 claims axis is risky-phrase density per 1,000 words. A page with no environmental claims scores 0 on the axis ("Low signals" for silent brands) and a page with many substantiated claims can outscore one with a few unsupported claims. The brief's rule is "missing data never increases the score", which the density formula honours, but the inverse (silence rewarded) is a measurement blind spot. Changing a formula without a measurement would be guesswork.

**Decision.** Phase 14, after the harness and the three sources: `claimsRate.version` in `config/weights.json`; v2 = share of unsupported claims among matched claim sentences (supported hits weighted by the existing points ratio), with an `insufficient_data` status when fewer than `minClaims` (director's value 5) claim sentences exist — the axis then contributes 0 and lowers confidence, with a could-not-check line. Both formulas are reported on the same harness (overall AUC, claims-axis AUC, Spearman diagnostic, two fictional regression fixtures). The builder ships `version: 1`; the director flips the config only if overall AUC does not fall by more than 0.02, the Spearman diagnostic moves toward 0, and the monotonicity property (6.2) holds for v2. The decision and the numbers are logged as ADR-032.

**Consequences.** The claims axis remains deterministic and LLM-free; `ai_share` is unaffected. A silent brand under v2 gets a lower confidence and an explicit "not scored" line instead of a low score, which is the honest reading. METHODOLOGY Section 11 documents both formulas and the active one.

---

## ADR-031 — v1.1 phase sizing, fixture honesty for registries, and dependency policy

**Date:** 2026-10-21
**Status:** accepted

**Context.** The human asked to "implement everything"; brief Section 0.4 caps rework and re-plans, and each phase must fit one builder session.

**Decision.** Six phases (10 validation, 11 SBTi, 12 FR index, 13 Sabin, 14 claims formula, 15 docs and final review), each one session, ordered so that every source change is measured. Fixtures follow ADR-011: real recorded registry rows and pages for real brands (recorder script, capture date, trimmed where large, hashes recorded), synthetic cases only for `.example` brands. One new runtime dependency (`exceljs`, MIT); no dependency that needs an account or a key. Pre-authorised cuts are listed in PLAN.md ("v1.1 hard limits"); the ground-truth isolation test, receipts, the licence gate, robots cleanliness and the 50% guard are never cut.

**Consequences.** If a phase exceeds 3 rework rounds, the director applies the listed cut and logs it; if two re-plans are used, remaining scope goes to `docs/LATER.md` with a HANDOFF note.
