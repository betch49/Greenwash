# Greenwash Radar — autonomous build brief for Claude Code

You are building **Greenwash Radar**: a web app where a person types a brand name and gets a transparent, evidence-backed greenwashing risk score. Read this whole file before writing any code. Follow the phases in order. Do not skip Phase 0.

**This build is fully autonomous.** The human will not answer questions during the run. Every decision is taken by the agents described in Section 0. The run ends only when the Definition of Done (Section 10) is met and verified, or when the hard budget (Section 0.4) is exhausted, in which case you write `docs/HANDOFF.md` explaining exactly where things stopped and why.

## 0. Orchestration: who decides what

### 0.1 Roles

Create two subagents in `.claude/agents/`:

- **`director`** — model `claude-fable-5-1`, effort **medium**. Owns judgment: runs the brainstorm, scores the proposals, picks the differentiators, writes the plan, reviews each phase, and decides when the app is done. Never writes application code. Writes only under `docs/`.
- **`builder`** — model `claude-opus-5-5`. Owns execution: implements the plan phase by phase, writes tests, runs them, fixes failures. May not change scope, weights or differentiators; if it believes the plan is wrong, it writes `docs/CHALLENGES.md` and the director rules on it.

The main session is the **orchestrator**: it calls the director, then loops over phases calling the builder and then the director for review, until done. The orchestrator does not make product decisions itself.

### 0.2 Brainstorm protocol (replaces any "ask the human" step)

1. The builder (or the orchestrator, if the builder is not yet needed) drafts `docs/BRAINSTORM.md` with the differentiators of Section 2, plus at least two new ideas of its own, each with: user value (1–5), feasibility in v1 (1–5), data availability (1–5), legal risk (1–5, lower is better), one-line evidence for each number.
2. The director critiques the draft: challenges every score it finds inflated, removes anything that cannot produce a receipt (Section 1), and may request one revision round.
3. The director picks **exactly three** differentiators (F, the claim-language engine, ships regardless) and records the decision with reasoning in `docs/DECISIONS.md` (ADR format, one entry per decision). The default preference is A, C, E; the director may override it only with written reasoning that cites the brainstorm scores.
4. The director writes `docs/PLAN.md`: phases, acceptance criteria per phase, and the test that proves each criterion. The plan must be executable without any further human input.

### 0.3 Phase loop

For each phase in `docs/PLAN.md`:
1. Builder implements, writes tests, runs the full suite, and writes a short `docs/phases/<n>.md` (what was built, what was skipped and why).
2. Director reviews against the acceptance criteria. Verdict: **pass** (next phase), **rework** (list of concrete defects; builder fixes; max 3 rework rounds per phase), or **re-plan** (director edits `docs/PLAN.md` and records why in `docs/DECISIONS.md`).
3. A phase cannot be marked pass with failing tests. Skipped tests must be justified in `docs/phases/<n>.md`.

### 0.4 Hard limits (so "never stop" cannot become "loop forever")

- Maximum 3 rework rounds per phase, maximum 2 re-plans in the whole run. If exceeded, the director must simplify scope (and log it) rather than keep retrying the same thing.
- Budget cap: if the run exceeds the token or time budget configured for the session, write `docs/HANDOFF.md` and stop cleanly.
- No external paid services other than the Anthropic API. No signing up for anything. If a data source needs an account, it is out of scope for v1 and goes to `docs/LATER.md`.
- Any decision the director would normally want a human for (legal wording, scope cut, data source dropped) is taken by the director and logged in `docs/DECISIONS.md` with the reasoning. The human reads that file afterwards.

## 1. Non-negotiable constraints

- **Language:** the entire product (UI, copy, code, comments, docs) is in English.
- **Simple, no frills.** One search box, one confirmation step, one report page. No marketing landing page, no accounts, no dark patterns, no decorative animations.
- **AI is a minority component.** At most 50% of the score and of the pipeline may depend on an LLM. The score itself must be computed by a deterministic formula from logged evidence. The LLM is used only for: (a) extracting structured claims from fetched text, (b) classifying archived-page diffs, (c) writing the plain-English summary. The LLM must never invent a source: it can only reference URLs that the pipeline actually fetched.
- **Every signal has a receipt.** Each line in the report shows: source URL, fetch date, raw excerpt. If a signal has no receipt, it is not shown and not scored.
- **Signals, not verdicts.** Wording is "risk signals", "unsupported claim", "claim removed between X and Y". Never "the brand lies" or "the brand is guilty". This is a legal and an honesty requirement.
- **Disambiguation is mandatory.** If the brand match is not confident, ask the user to confirm before running anything.
- **Caching.** Every external fetch is cached (SQLite) with a timestamp. Respect robots.txt and rate limits (Wayback: ≤1 req/s). A report for a known brand must be re-servable from cache in under 1 second.

## 2. Phase 0 — Brainstorm (run by the director, see 0.2)

Before any code, `docs/BRAINSTORM.md` must cover:

1. **What exists already** (Good On You, Fashion Transparency Index, B Corp directory, CDP, ChatGPT-style "ask AI"). In one line each: what they do, why they are not enough (mostly: opaque methodology, or pure LLM opinion with no receipts, or paywalled).
2. **Our edge.** Score and rank the differentiators below. The director picks exactly three for v1 and records the decision in `docs/DECISIONS.md`. No human confirmation is needed or expected.

Candidate differentiators (add your own if you find better ones):

- **A. Claim retraction detector (Wayback Machine).** Use the archive.org CDX API to pull snapshots of the brand's sustainability / about / product pages over time. Diff them. Flag claims that *disappeared* (e.g. "carbon neutral", "100% recyclable", "plastic-free") and correlate the removal date with regulator actions or press coverage. A claim quietly removed is one of the strongest greenwashing signals that no competitor surfaces.
- **B. Goal-drift detector.** Extract dated commitments ("net zero by 2030", "100% recycled by 2025") from snapshots across years. Detect when a target date is pushed back or the target silently rewritten. Show a timeline.
- **C. Regulator rulings matcher.** Deterministic lookup of the brand in public advertising-standards and consumer-protection decisions: UK ASA rulings, France JDP (Jury de Déontologie Publicitaire), Netherlands ACM / Reclame Code Commissie, US FTC, Italy AGCM. No APIs exist for most of these: build small adapters (search page + parse), start with two countries, design for more.
- **D. Certification registry check.** Verify claimed labels against the issuing body's public database (B Corp directory, GOTS public database, Fair Trade USA licensee list, SBTi target dashboard CSV, bluesign partners, 1% for the Planet members). A label mentioned on the brand site but absent from the registry is a signal.
- **E. Ownership & repair axis (Louis Rossmann angle).** "Durable" and "built to last" claims are hollow if the brand blocks repair. Check: public repair manuals, spare-parts availability, warranty length, repair program, iFixit repairability scores where applicable, known anti-repair practices (serialised parts, warranty-void stickers, lawsuits against independent repair). This axis is unique in the greenwashing space.
- **F. Claim-language engine (deterministic).** Rule-based scan of fetched pages for vague terms ("eco-friendly", "natural", "green"), absolutes ("zero impact", "100% sustainable"), offset language ("carbon neutral" without reduction data), comparisons without a baseline ("more sustainable"), and future-tense commitments without progress data. Reuse and extend; this is cheap and must ship in v1 regardless.
- **G. Intensity-vs-absolute emissions check.** If a brand publishes emissions, detect whether it reports only intensity (per € or per unit) while absolute emissions rise. Deterministic when a report PDF is found.

Default preference: A, C, E (plus F as baseline). The director overrides it only with written reasoning backed by the brainstorm scores.

## 3. Product flow

1. **Search.** Single input: "Brand name". Enter runs the search.
2. **Disambiguate.** Query Wikidata (`wbsearchentities`, then `wbgetentities`) for entities that are a brand, company or organisation. Take the official website (P856), parent company (P749), industry (P452), country (P17), logo if available.
   - If one result scores clearly above the rest (exact-name match + has website + is a company): proceed.
   - Otherwise show up to 3 cards: "Did you mean **Patagonia, Inc.** — outdoor apparel, United States, patagonia.com?" with Confirm / Not this one. Never run the pipeline on an unconfirmed match.
   - If nothing is found: let the user paste the brand's website URL and continue with that.
3. **Analyse.** Run the pipeline (Section 5) with a progress list that names each step ("Fetching sustainability pages", "Pulling 2019–2026 snapshots", "Checking ASA rulings"…). Steps that fail are shown as "skipped: reason", never hidden.
4. **Report.** One page:
   - Headline: risk score 0–100 with a three-word label (Low / Moderate / High signals) and the sentence "Based on N verified signals from M sources."
   - Four axes, each with its own sub-score and its receipts list.
   - Timeline (if A or B is active): claims appearing / disappearing over the years.
   - "What we could not check" section. Honesty about gaps is a feature.
   - Methodology link: a static page that explains every weight.
   - Share/export: a link to the report (cached) and a JSON download of the evidence.

## 4. Scoring (deterministic, documented in `docs/METHODOLOGY.md`)

Score = weighted sum of four axes, each 0–100, higher = more greenwashing risk.

| Axis | Weight | Inputs | LLM involved? |
|---|---|---|---|
| Claim language | 25% | F: counts of vague / absolute / offset / baseline-less / future-only claims, normalised per 1,000 words | No (LLM may propose candidate claims, but the rule engine decides) |
| Evidence & certifications | 25% | D: labels claimed vs verified; presence of absolute emissions, supply-chain list, impact report | No |
| Track record | 30% | A: removed claims; B: goal drift; C: regulator rulings (recent and upheld weigh more) | Partially (LLM classifies a diff as "claim removed" vs "redesign"; a human-readable rule caps its influence) |
| Ownership & repair | 20% | E: repair manuals, parts, warranty, repair program, anti-repair signals | No |

Rules:
- Missing data never increases the score; it lowers the **confidence** value shown next to it (e.g. "Score 62, confidence 40%").
- Log, for each report, which sub-signals depended on an LLM call. Expose `ai_share` in the JSON and in the UI ("AI contributed to 31% of this score"). Add a test that fails if `ai_share` can exceed 50% for any input.
- Weights live in one config file. No magic numbers in code.

## 5. Pipeline (each step is an independent module with its own tests)

```
input brand → disambiguate (Wikidata) → discover pages (sitemap + heuristics:
/sustainability, /impact, /responsibility, /our-footprint, /about)
→ fetch current pages → fetch Wayback snapshots (CDX, 1 per year, last 8 years)
→ claim engine (rules) → diff engine (snapshot vs snapshot)
→ LLM: structured claim extraction + diff classification (JSON schema, strict)
→ registry checks → regulator checks → repair checks
→ scorer → report (JSON) → UI
```

- Every module returns `Signal[]`: `{axis, kind, weight_hint, source_url, fetched_at, excerpt, snapshot_date?, llm_used: bool}`.
- LLM calls use the Anthropic SDK with tool-use / JSON schema, temperature 0, and a system prompt that forbids referencing anything outside the provided text. Validate every output against the schema; drop invalid items.
- Wayback: `https://web.archive.org/cdx/search/cdx?url=<page>&output=json&filter=statuscode:200&collapse=timestamp:4` then fetch `https://web.archive.org/web/<ts>id_/<url>` (the `id_` flag returns the raw page). Diff on visible text only (strip nav/footer).

## 6. Stack (keep it boring)

- **Next.js (App Router) + TypeScript**, server route handlers for the pipeline, SQLite via Drizzle for cache and saved reports. No separate backend unless scraping proves painful; if it does, a small Python service is acceptable, but justify it in `docs/BRAINSTORM.md`.
- Fetching: `undici`, `cheerio` for HTML, `pdf-parse` for reports.
- Tests: Vitest for modules, Playwright for the three-screen flow. Fixtures: real saved HTML of 3 brands (one outdoor apparel, one electronics, one food) so tests run offline.
- Env: `ANTHROPIC_API_KEY` (used only by the built app's LLM layer, at runtime), optional `WAYBACK_RATE_LIMIT_MS`. No other secrets in v1. **The key may be absent during the build.** All tests must run with a mocked LLM client (recorded JSON fixtures). If the key is present in the environment, run the real end-to-end check of Section 10; if it is absent, mark that single item "deferred: no API key" in `docs/FINAL-REVIEW.md` and still finish the run.
- UI: plain CSS or Tailwind, system font stack, light/dark via `prefers-color-scheme`, works on a phone. No component library.

## 7. Phases and deliverables

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | `docs/BRAINSTORM.md`, `docs/DECISIONS.md`, `docs/PLAN.md` | Director has logged the three differentiators and an executable plan |
| 1 | Search + Wikidata disambiguation + confirm screen | Playwright test: "patagonia" → confirm card → proceeds; "acme" → URL fallback |
| 2 | Page discovery + fetch + cache | 3 fixture brands fetched offline from fixtures |
| 3 | Claim-language engine (F) | Unit tests on 20 sentences, documented rules in `docs/METHODOLOGY.md` |
| 4 | Wayback snapshots + diff + retraction detector (A) and/or goal drift (B) | Timeline renders for a fixture with a known removed claim |
| 5 | Regulator adapters (C), registry checks (D), repair axis (E) — only those confirmed in Phase 0 | Each adapter has a fixture test and a "skipped: reason" path |
| 6 | Scorer + `ai_share` guard + methodology page | Test proves `ai_share ≤ 0.5` for all fixtures |
| 7 | LLM layer (extraction, diff classification, summary) | Schema validation tests; summary cites only fetched URLs |
| 8 | Report UI, JSON export, shareable cached report | Full flow on phone and desktop; Lighthouse accessibility ≥ 90 |
| 9 | `README.md` (setup, limits, legal wording), `docs/LIMITATIONS.md`, `docs/FINAL-REVIEW.md` | Director's final review confirms the Definition of Done (Section 10) |

After each phase: run tests, write `docs/phases/<n>.md`, get the director's verdict. Do not start the next phase if tests fail or the verdict is not pass.

## 8. Things to avoid

- Scraping sites that forbid it in robots.txt; rely on Wayback for those and say so.
- Any wording that states a fact about a brand that is not in a receipt.
- Letting the LLM produce numbers that feed the score.
- Feature creep: no user accounts, no comparisons, no browser extension in v1. Note good ideas in `docs/LATER.md` instead.

## 8b. Environment notes (cloud session started from the Claude mobile app)

- You run in a cloud environment with a GitHub repository. Commit after every passing phase with the message `phase <n>: <title>`; push so the human can follow from the phone.
- Network access may be restricted. Required outbound domains: `web.archive.org`, `www.wikidata.org`, `registry.npmjs.org`, plus the brand sites and regulator sites you fetch. If a domain is blocked, record it in `docs/LIMITATIONS.md` and use saved fixtures instead; do not stall.
- Use the permission mode that lets you work without approvals. If an action needs approval and nobody answers, choose the safer alternative and log it.

## 9. Startup sequence (no human in the loop)

1. Create the two subagents (Section 0.1).
2. Run the brainstorm protocol (Section 0.2) until `docs/PLAN.md` exists.
3. Run the phase loop (Section 0.3) until the director's `docs/FINAL-REVIEW.md` states that every item in Section 10 is met, with the command or test that proves each one.
4. Print a final summary: what was built, the three differentiators chosen, `ai_share` on the fixture brands, known limitations, and the exact commands to run the app.

Do not pause to ask questions. If something is ambiguous, the director decides and logs it.

## 10. Definition of Done

The run is finished only when all of the following are true and verified by the director:

- `npm install && npm run dev` starts the app with no errors; `npm test` and the Playwright flow pass.
- The three screens work on phone and desktop: search → confirm (or URL fallback) → report.
- At least one real brand (not a fixture) produces a report end to end with a working `ANTHROPIC_API_KEY`, and the same report is served from cache afterwards in under 1 second. (Deferred, not failed, if no key is available in the build environment; everything else still passes with the mocked LLM.)
- The three chosen differentiators each produce at least one receipted signal on a fixture brand.
- `ai_share ≤ 0.5` is enforced by a test, and shown in the UI.
- Every signal shown has a source URL, a fetch date and an excerpt; the "What we could not check" section is populated honestly.
- `docs/METHODOLOGY.md`, `docs/LIMITATIONS.md`, `docs/DECISIONS.md` and `README.md` exist and match what the code does.
