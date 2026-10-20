# Greenwash Radar — Later (ideas cut from v1)

Cut by the director in Phase 0 (see `docs/BRAINSTORM.md` Section 5 and `docs/DECISIONS.md`). Builders add to this file instead of implementing anything not in `docs/PLAN.md`.

| Idea | Why not v1 | What would unblock it |
|---|---|---|
| **B. Goal-drift detector** | Matching "the same target" across rewordings is LLM-heavy and would feed numbers (years) into the score, against the 50% cap and the "LLM never produces scored numbers" rule. | A deterministic dated-target extractor (regex on "by 20XX" near a commitment noun) with exact-noun matching; reuse Phase 4 snapshot pipeline. |
| **D. Certification registry check** | bcorporation.net is Cloudflare-challenged for server fetchers; B Lab dataset needs an account (Section 0.4 forbids); GOTS/SBTi exports unverified. | A registry with a public CSV/JSON export (SBTi dashboard CSV, 1% for the Planet, bluesign) verified reachable; then "label claimed vs registry" becomes receipted. |
| **G. Intensity-vs-absolute emissions** | Needs PDF table extraction; `pdf-parse` gives text only; would justify a Python service we decided against. | pdfplumber service or a reliable text-table heuristic validated on 10 real reports. |
| **I. EU 2024/825 category mapping** | Citation layer, no new receipt; "restricted under" reads as a compliance verdict; brand may not sell in the EU. | Country-of-sale detection plus careful wording reviewed against the directive text. |
| **K. Parent-company roll-up (Wikidata P749)** | Legal risk of attributing a parent's ruling to a brand; zero score weight by design, so cost without score value in v1. | Separate "parent company" section with its own receipts list and explicit "does not affect this score". |
| **Regulators: US FTC, NL ACM / Reclame Code Commissie, IT AGCM** | FTC full-text filter did not filter from the container; ACM/RCC/AGCM search paths unknown. | One adapter per body behind the existing `RegulatorAdapter` interface; each needs a recorded search fixture. |
| **H with one link hop** | v1 checks substantiation on the same page only, to keep Phase 3 to one session. | Follow links whose text matches /report|methodology|data|footnote/ one hop, through the cached fetcher. |
| **Anti-repair practices (serialised parts, warranty-void stickers, lawsuits)** | No structured public source; cannot be receipted. | A curated, sourced dataset with a URL per entry (e.g. right-to-repair organisations' public lists). |
| **Headless rendering of JS-only brand pages** | Pipeline is fetch + cheerio only; Playwright is a test dependency. | Optional Playwright-based fetcher behind the `Fetcher` interface, rate-limited. |
| **Brand comparisons, accounts, browser extension** | Brief Section 8 forbids in v1. | — |
| **Wayback live verification in CI** | web.archive.org resets connections from the build container. | Run the live Wayback smoke test on a machine with normal internet. |
| **Stale robots.txt on fetch failure (ADR-012 amendment)** | Phase 1 cached fetcher does not serve a stale entry when the live fetch fails; today the origin is skipped with a shown reason. | Phase 8: serve the last cached `/robots.txt` from SQLite on 5xx/network error. (Director, Phase 2 round-2 review.) |

- **Quotation and stance detection for the claim engine.** Sentences that quote a third party, criticise a practice or state a global statistic can match a claim rule (seen on Oatly, Mammut, Fairphone pages). v1 shows every match with its sentence (ADR-015); a deterministic quote/stance filter is a later improvement.
