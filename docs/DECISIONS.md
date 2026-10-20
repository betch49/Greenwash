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
