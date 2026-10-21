# Challenges (builder → director)

## C-1 (Phase 3) — "a year" alone is a weak substantiation marker

**Plan text.** Phase 3 deliverable 2: a matched sentence is substantiated if the sentence or the following two contain a number + unit, **a year**, a named standard, or an evidence link.

**Observation.** Implemented as written (`src/lib/claims/substantiation.ts`; the claim's own trigger words are masked, so "net zero by 2040" is not substantiated by its own 2040). On the fictional fixture, "We are carbon neutral." is followed by "We will be net zero across our entire business by 2040." and "We aim to cut … by 2030, measured against a 2019 baseline …". The years in those two *other claims* mark the neutrality claim as `claim.supported`, although nothing next to it supports it. The same happens on real pages wherever claims cluster (targets lists, timelines). A target year is not evidence.

**Proposal (not implemented).** Count a year as a marker only when it is not part of a target phrase ("by 20XX", "until", "before", "no later than") anywhere in the window, or only when it sits next to a figure. One lexicon entry and two tests; the 3.2 acceptance case still passes (it has "41%" and "since 2020").

**Effect today.** Conservative: the plan's rule can only turn `claim.unsupported` into `claim.supported`, which lowers risk, never raises it. Per-1,000-word match counts (the claims-axis input) are unaffected.

### Director ruling on C-1 (2026-10-20, ADR-014)

**Upheld, and broadened.** Reproduced on the fixture and on constructed sentences: a year alone (founding year, collection year, target year) and a target figure ("committed to 100% renewable") both mark claims as `claim.supported`. Ruling: a year is never a marker on its own (only recorded next to a number + unit in the same sentence, and never after by/until/before/no later than/towards); a window sentence that itself matches `future_only` contributes no marker; for a `future_only` hit the matched sentence contributes no number + unit marker. PLAN Phase 3 deliverable 2 and criterion 3.2 amended accordingly. Fix in Phase 3 rework round 1 (docs/phases/3.md, defect 1).

## C-2 (Phase 5) — iFixit's robots.txt disallows the search endpoint the plan names

**Plan text.** Phase 5 deliverable 5: `GET https://www.ifixit.com/api/2.0/search/<brand>?filter=device` (and `/guide`).

**Observation.** `https://www.ifixit.com/robots.txt` (fetched 2026-10-20, recorded in `fixtures/sources/robots/www-ifixit-com.txt`) has, for `User-agent: *`, `Disallow: /api/*` with explicit `Allow: /api/2.0/categories*`, `Allow: /api/2.0/guides*`, `Allow: /api/2.0/wikis*`. `/api/2.0/search/…` is therefore disallowed, and ADR-010 makes the robots guard mandatory for repair sources (the API exemption list is Wikidata and Wayback only). Implemented as written, the call would always end as `skipped: robots.txt disallows …` and criterion 5.6 could never be met by a real capture.

**What I did.** Kept within the plan's intent (iFixit data, receipted, via the API) and within ADR-010: `src/lib/repair/ifixit.ts` reads the allowed device-category endpoint `/api/2.0/wikis/CATEGORY/<brand>` and the brand's device sub-categories (guide titles, repairability score). Matching is conservative (category title must equal the brand name after normalisation). The search endpoint is never requested; a test asserts every `/api/` call is under `/api/2.0/wikis/CATEGORY/`.

**Asked of the director.** Confirm the endpoint substitution (or rule otherwise); no ADR change needed since the robots guard is unchanged.

## C-3 (Phase 5) — Deliverable 3's "whole-word match ⇒ scored" contradicts criterion 5.3

**Plan text.** Deliverable 3: `scored` only if the normalised brand is a whole-word match in title or advertiser; else `possible`. Criterion 5.3: "Patagonia" vs "Patagonia Provisions Ltd" ⇒ `possible`; "Acme" vs "Acme Widgets" ⇒ `possible`; "Pata" vs "Patagonia" ⇒ no match.

**Observation.** "patagonia" is a whole word of "patagonia provisions", so deliverable 3 would score it, and "Pata" vs "Patagonia" would be `possible` (the "else"), not "no match". The criteria describe a stricter, three-way rule.

**What I did.** Implemented the criteria (`src/lib/regulators/match.ts`, METHODOLOGY Section 9.5): **scored** = one of the advertiser's names (split on "t/a") *equals* the brand after normalisation (legal suffixes, plus a short list of trailing geographic/structural qualifiers such as UK, Europe, International, Holdings in `config/regulators.json`; spacing ignored); **possible** = whole-word occurrence otherwise; **none** = not even a whole word. Consequence for the documented case: "Shell" vs "Shell Energy Retail" ⇒ `possible` (and the real "Shell Energy UK" ruling in the recorded ASA search is shown as possible, not scored), while "Shell UK Ltd t/a Shell" is scored. This is the conservative side the orchestrator asked for ("no ruling attached on a fuzzy name match").

**Asked of the director.** Confirm the reading of deliverable 3, or name the rule to apply instead.

### Director ruling on C-2 (2026-10-21, ADR-018)

**Upheld.** The recorded robots.txt disallows `/api/2.0/search`; ADR-010 admits no new exemption, and brief Section 8 forbids scraping what robots.txt forbids. The device-category endpoint `/api/2.0/wikis/CATEGORY/<brand>` is the plan's endpoint from now on; the equality rule on the category title and the test pinning every `/api/` call under `/api/2.0/wikis/CATEGORY/` are required, not optional. PLAN Phase 5 deliverable 5 corrected. Phase 6 weighting note in the ADR.

### Director ruling on C-3 (2026-10-21, ADR-019)

**Upheld.** Criterion 5.3 is the rule; deliverable 3 was wrong by its own criterion. Scored only on name equality after normalisation (advertiser split on "t/a", legal suffixes and the short qualifier list removed, spacing ignored); whole-word occurrence is `possible`, shown and never scored; "Shell" vs "Shell Energy Retail" ⇒ `possible`, as implemented and documented in the test. ADR-003's "appears in" is superseded. PLAN Phase 5 deliverable 3 corrected.
