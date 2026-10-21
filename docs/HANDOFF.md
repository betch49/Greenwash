# Handoff — v1.1 run stopped at 11:00 Zurich, 2026-10-21

The human asked the run to stop at 11:00 Zurich time. This file records where v1.1 stands and what the next session should do.

## Status by phase

| Phase | Scope | Status |
|---|---|---|
| 10 | Validation set (22 flagged / 20 well-rated / 6 contested, fetched citations) + `npm run validate` | Built, director PASS |
| 11 | SBTi "Commitment removed" signal (track axis) | Built, director PASS (post-merge items done in the 10–13 integration) |
| 12 | French repairability index (data.gouv.fr, licence gate) | Built, director PASS (ADR-036 on robots route) |
| 13 | Sabin Center litigation cases | Built, director REWORK round 1 → fixes applied in integration; **not re-reviewed** |
| 14 | Claims formula v2 (behind flag, **off**), ADR-033 environmental-topic gate, not-upheld rulings 0 pts, evidence gate when no sustainability page, wider non-durable industries | Built; **not yet reviewed by the director** |
| QA fixes | "Not enough evidence to score" display, rule-based fallback summary, lookup-error heading, URL typed in search, site-name for URL fallback, double-submit dedupe, stale Back state, input cap, copy | Built; **not yet reviewed by the director** |
| 15 | Docs sync (README, LIMITATIONS, METHODOLOGY), FINAL-REVIEW-v1.1 | **Not started** |

Merge/test status at stop time: everything above is merged on `claude/new-session-g9w7x3` at `e78e965`. Verified on that commit: Vitest 636/636 (86 files, by the final merge builder); Playwright 50/50 (full run by the orchestrator after the push); lint, typecheck and build clean. Offline validation (tag `final`, claims v1): AUC 0.67 on 5 of 48 brands, track-axis AUC 1.00. Merge notes: `docs/phases/15-merge.md`. Open for the director: the new test 8.5 behaviour (a URL-fallback run is now named from the homepage, so it reuses an existing report), weights version left at 2 despite two new 0-point kinds, claims v2 (C-14), and the QA-2/QA-3 builder decisions.

## Key finding

The validation harness shows the v1 score does **not** yet separate brands flagged by third parties from well-rated ones. Live partial run (Phase 10, 15 reports): AUC 0.34; claims-axis AUC 0.20 (reversed). Offline (5 brands, indicative only): AUC 0.67 → 0.67 with the Phase 14 gates on the v1 formula, 0.83 with claims v2 — but v2 failed the director's acceptance gate (Spearman moved away from 0; monotonicity breaks when a supported sentence is removed — CHALLENGES C-14), so `claimsRate.version` stays 1.

## Next steps (in order)

1. **Director review** of Phase 13 rework, Phase 14 and the QA fixes (`docs/phases/13.md`, `14.md`, `qa-fixes.md`, `15-merge.md`). Rule on C-14 and the Phase 14 builder decisions.
2. **Session with the API key.** The key is now set in the environment settings as `ANTHROPIC_API_KEY`; a new session sees it. In that session:
   - confirm the key is set (do not print it) and make one small test call;
   - check `ANTHROPIC_BASE_URL` does not redirect the app's calls away from api.anthropic.com;
   - `npm run build && npm run e2e:real -- fairphone --website https://www.fairphone.com --prod` (closes the deferred v1 DoD item);
   - re-record LLM fixtures with `GR_RECORD_LLM=1` (they are hand-authored stand-ins today);
   - `npm run validate -- --mode live` over all 48 brands with the AI steps on, from a network where Wayback is reachable if possible.
3. **Fix the claims formula** using the live validation numbers (C-14): e.g. unsupported share with a monotone construction, or a per-page cap; flip `claimsRate.version` only when the director's 14.6 gate passes.
4. **Phase 15**: README/LIMITATIONS/METHODOLOGY sync for 10–14 + QA, SOURCES licence notes in README (SBTi non-commercial terms), `docs/FINAL-REVIEW-v1.1.md`.
5. Known open items: Next 15 → 16 upgrade (`npm audit`), methodology page condensed phone layout, auto-redirect when analysis finishes (QA item 9), LLM answer caching.
