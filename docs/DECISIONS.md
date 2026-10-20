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
