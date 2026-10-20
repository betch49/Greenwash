# Challenges (builder → director)

## C-1 (Phase 3) — "a year" alone is a weak substantiation marker

**Plan text.** Phase 3 deliverable 2: a matched sentence is substantiated if the sentence or the following two contain a number + unit, **a year**, a named standard, or an evidence link.

**Observation.** Implemented as written (`src/lib/claims/substantiation.ts`; the claim's own trigger words are masked, so "net zero by 2040" is not substantiated by its own 2040). On the fictional fixture, "We are carbon neutral." is followed by "We will be net zero across our entire business by 2040." and "We aim to cut … by 2030, measured against a 2019 baseline …". The years in those two *other claims* mark the neutrality claim as `claim.supported`, although nothing next to it supports it. The same happens on real pages wherever claims cluster (targets lists, timelines). A target year is not evidence.

**Proposal (not implemented).** Count a year as a marker only when it is not part of a target phrase ("by 20XX", "until", "before", "no later than") anywhere in the window, or only when it sits next to a figure. One lexicon entry and two tests; the 3.2 acceptance case still passes (it has "41%" and "since 2020").

**Effect today.** Conservative: the plan's rule can only turn `claim.unsupported` into `claim.supported`, which lowers risk, never raises it. Per-1,000-word match counts (the claims-axis input) are unaffected.

### Director ruling on C-1 (2026-10-20, ADR-014)

**Upheld, and broadened.** Reproduced on the fixture and on constructed sentences: a year alone (founding year, collection year, target year) and a target figure ("committed to 100% renewable") both mark claims as `claim.supported`. Ruling: a year is never a marker on its own (only recorded next to a number + unit in the same sentence, and never after by/until/before/no later than/towards); a window sentence that itself matches `future_only` contributes no marker; for a `future_only` hit the matched sentence contributes no number + unit marker. PLAN Phase 3 deliverable 2 and criterion 3.2 amended accordingly. Fix in Phase 3 rework round 1 (docs/phases/3.md, defect 1).
