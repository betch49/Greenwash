# Greenwash Radar — Methodology

Version 1 (Phase 3). This document describes how Greenwash Radar turns fetched pages into greenwashing risk signals. A signal is a pointer to text a brand published, with a receipt: the page URL, the date we fetched it, and the excerpt. **Signals, not verdicts.** Nothing here decides whether a claim is true; the rules only say whether a sentence uses a known risky pattern and whether supporting detail appears next to it on the same page.

Everything in this document is deterministic. No language model is involved in any rule below, and every signal they produce has `llm_used: false`.

Code: `src/lib/claims/` (rules, lexicon, substantiation, engine, evidence rules). The phrase lists are data in `src/lib/claims/lexicon.ts`. Tests: `tests/unit/claims/`. A test reads this file and checks that every rule id the engine exports is listed here and that every example below classifies as stated (`tests/unit/claims/methodology-sync.test.ts`).

## 1. From a page to sentences

1. **Visible text.** Each fetched page is reduced to its visible text (`src/lib/discover/visible-text.ts`): scripts, styles, hidden elements and site chrome (navigation, header, footer, sidebars, and everything outside the page's main landmark when it has one) are removed. Headings, paragraphs and list items become separate lines. Links are kept with their text and a region (`content` or `chrome`).
2. **Sentences.** Each line is split into sentences (`src/lib/claims/split.ts`). A sentence ends at `.`, `!`, `?` or `…` followed by whitespace and a character that is not a lowercase letter, unless the full stop closes a known abbreviation (e.g., Inc., Ltd., U.S.) or a single initial. Lines never join. The splitter is deterministic: the same text always gives the same sentences.
3. **Questions.** A sentence that ends with a question mark asserts nothing and never matches a claim rule ("How sustainable is a phone?").
4. **Word count.** Words are whitespace-separated tokens that contain a letter or a digit.

## 2. Claim-language rules (axis: claims)

Each rule looks at one sentence, and for some rules at the sentence that follows it. Phrases are matched case-insensitively and on word boundaries (so `green` never matches `evergreen`). A sentence can match more than one rule; each match counts once per rule.

### `vague` — vague environmental wording

Wording that has no defined meaning and no measurable content: eco-friendly, environmentally friendly, earth-friendly, planet-friendly, climate-friendly, eco-conscious, "conscious" + choice/collection/exploration and similar, responsibly made / sourced / produced, "green" + company/products/materials and similar, natural products / materials / ingredients, "safe and natural", clean products / materials / production, low-impact, kind to the planet. Also **"sustainable" used bare**: not preceded by more, most, less, fully, completely, 100% or truly (those belong to other rules) and not part of a proper name such as "Sustainable Development Goals".

- hit: “Our jackets are made with eco-friendly materials.”
- hit: “We are a sustainable company.”
- miss: “We report against the Sustainable Development Goals.”

### `absolute` — absolute claims

Claims that admit no impact at all: zero impact, no impact on…, impact-free, 100% (or 100 percent) sustainable / natural / green / eco-friendly / clean, fully / completely / totally / entirely / truly sustainable or natural, "the most sustainable", harmless to the planet. "Zero waste" counts only when bare: a sentence that qualifies it ("to landfill", "to incineration", "certified", "by 20…") does not match.

- hit: “Our packaging is 100% sustainable.”
- hit: “We are a zero waste company.”
- miss: “Our factory sends zero waste to landfill.”

### `offset` — neutrality claims without a reduction figure

Present-tense neutrality claims: carbon neutral, climate neutral, CO2 neutral, e-waste neutral, plastic neutral, net zero, carbon or climate positive or negative, carbon-free, fully offset, climate-compensated. The rule does not match when:

- the sentence talks about the future (will, by 20XX, aim to, target, goal, ambition, commitment, pledge, plan to, path to, going to, reach, achieve, become…); that is the `future_only` rule's job;
- the same sentence or the next one contains a **reduction figure**: a number with a unit (%, percent, t, tCO2e, kg, kWh…) in a sentence that also has a reduction word (reduce, cut, lower, decrease, fell, dropped, down, avoided, less);
- "net zero" is part of a proper name (for example "Oxford Net Zero").

- hit: “We are carbon neutral.”
- hit: “Our stores are net zero today.”
- miss: “Carbon neutral since 2020: we cut scope 1–2 emissions by 41% (see our 2024 report).”

### `baseline_less_comparison` — comparisons without a baseline

Comparisons with nothing to compare against: more sustainable / responsible / circular / eco-friendly, greener or cleaner + choice/production/materials and similar (or "is greener", "is cleaner"), less plastic / water / waste / packaging / impact / emissions, lower impact / footprint / emissions, smaller or reduced footprint, better for the planet / environment / climate, kinder to the planet. The rule does not match when the sentence contains "than", "compared with/to", "versus", "relative to" or "baseline", a percentage, or a year.

- hit: “Our new shell fabric is more sustainable.”
- hit: “Longer device lifespans are better for the planet.”
- miss: “The new bottle uses 30% less plastic than the old one.”

### `future_only` — future commitments without a progress figure

Commitments about the future: we will / we'll / we shall, "our products (packaging, company…) will", "will be carbon neutral / net zero…", by 20XX, aim to, aspire to, committed to, pledge to, our goal / target / ambition is, we plan to, strive to, working towards, on the way to. When "by 20XX" is the only trigger in the sentence, the sentence must also name who commits: we, we're, we've, our, us, the company, the brand, the group, or the brand name of the run (with legal suffixes such as AB, Inc or Ltd removed). "By 2050, an estimated 120 million tons of e-waste will be generated" is a statistic, not a commitment, and does not match. The sentence must also name an environmental topic (emissions, carbon, climate, net zero, renewable, recycling, packaging, waste, water, plastic, regenerative, sustainability, biodiversity, footprint, energy, circularity, environment, planet, nature, scope 1/2/3, fossil, PFAS, chemicals), otherwise "will" is ordinary grammar. The rule does not match when the same sentence or the next one contains a **progress figure**: a number with a unit in a sentence that also has a progress word (since, so far, to date, already, have / has / had, achieved, reached, cut, reduced, fell, decreased, dropped, was, were, last year, in 20XX).

- hit: “We will be net zero by 2040.”
- hit: “By 2030 we will halve our packaging waste.”
- miss: “We will email you a receipt.”
- miss: “By 2050, an estimated 120 million tons of e-waste will be generated annually.”

The twenty sentences in `tests/unit/claims/sentences.ts` (four per rule) are the acceptance set for these rules.

## 3. Same-page substantiation

For every matched sentence the engine looks at a **window**: the sentence itself and the two sentences that follow it on the page. The claim is **substantiated** if the window contains at least one marker:

- a number with a unit: %, percent, t, tCO2e, tonnes, kg, kWh, MWh, litres, m³…;
- a named standard or certifier: GOTS, Fair Trade, Fairtrade, B Corp, FSC, bluesign, OEKO-TEX, SBTi, ISO 14001, Cradle to Cradle, EU Ecolabel, Rainforest Alliance, RWS, RDS, GRS, RCS, Climate Neutral Certified, 1% for the Planet, Fair Wear, TCO Certified, iFixit (acronyms are matched in capitals only);
- a content link whose text appears in the window and matches report, data, methodology, footnote, study or assessment (at least four characters long).

**Targets are not evidence** (ADR-014):

- **A year is never a marker on its own.** "Founded in 1998" or "Shop the 2025 collection" supports nothing. A year (1950–2099) is recorded only next to a number with a unit in the same sentence, to show when the figure applies, and never when it follows by, until, till, before, no later than, towards, toward or ahead of (a target date).
- **A window sentence that is itself a `future_only` commitment contributes no marker of any kind.** "We are carbon neutral." followed by "We will be net zero by 2040." stays unsupported. For a hit of another rule, this includes the matched sentence: in "We will be a sustainable company by 2030." both the vague hit and the future-only hit are unsupported.
- **For a `future_only` hit, its own sentence contributes no number with a unit.** The rule has already established that the figure sits next to no progress word, so it is the target ("committed to 100% renewable electricity"). A named standard or an evidence link in that sentence still counts.

The claim's own trigger words are blanked out before the matched sentence is searched, so a claim is never its own evidence: "100% sustainable" is not substantiated by its "100%".

Result per match:

| Kind | Meaning | Label |
|---|---|---|
| `claim.unsupported` | No marker in the window. | "Unsupported claim (…): no supporting data found on the fetched page" |
| `claim.supported` | At least one marker in the window. Still a risk signal: a marker shows that detail is nearby, not that the claim is right. | "Risk signal (…); a figure with a unit, a named standard or a report link appears next to it on the page" |

Substantiation is limited to the same page: a figure published elsewhere (a PDF report, another page) is not seen by this rule.

## 4. Claim signals and per-1,000-word rates

`scanPage(text, page)` (`src/lib/claims/engine.ts`) returns:

- **Signals**, one per distinct sentence and rule on a page: axis `claims`, kind `claim.unsupported` or `claim.supported`, excerpt = the matched sentence (cut to 300 characters around the matched phrase if longer), `source_url` and `fetched_at` = the page record, `llm_used: false`. The same sentence on several pages of a run gives one signal, from the first page.
- **ClaimStats**: per rule, the number of matches and of unsupported matches, and both per 1,000 words (`matches × 1000 / words`). Repeated sentences count every time they occur, so a page duplicated three times has the same rates as the page once. A run's stats are the sums over its pages, with rates recomputed over the total word count. These rates are the claims-axis input of the score (brief Section 4); the scorer arrives in Phase 6.

## 5. Evidence rules (axis: evidence)

These run over all fetched pages of a run, including link text in the site chrome (a footer "Impact report" link counts).

### `labels_claimed`

Certifier and label names from the list in Section 3 (except SBTi and iFixit, which are not labels) found in the page text. Each label is listed once, with the first page that names it, as **"label claimed on page; not verified in v1"** under "What we could not check". Labels claimed are never signals and never enter the score: v1 does not check certification registries.

### `impact_report_link`

A link whose text or URL contains "report", "impact" or "sustainability" and that is a PDF or carries a year. The report year comes from the link text, else the file name, else the rest of the URL; years after the fetch year (targets such as 2030) are ignored. The newest dated report across all pages is kept (on a tie, a PDF wins).

| Kind | When |
|---|---|
| `evidence.report_found` | Newest report year is at most 2 years before the fetch year. Label: "Impact or sustainability report linked (YEAR)". |
| `evidence.stale_report` | Newest report year is more than 2 years before the fetch year. |
| `evidence.report_found_undated` | Only undated PDF report links. |
| `evidence.no_report_found` | No report link on any fetched page. Receipt: the first page; excerpt: the list of page titles scanned. |

The receipt of a found report is the page that links it; the excerpt is the link text and target.

### `absolute_emissions_present`

A number followed by an absolute emissions unit: tCO2e, t CO2, tonnes (of) CO2e, metric tons CO2e. Sentences about avoided, saved, offset or compensated emissions, and per-unit figures (per litre, per product, per device), do not count. The first page with such a figure gives `evidence.absolute_emissions_found`; excerpt = the sentence.

### `supplier_list_present`

A link whose text names a supplier list, factory list, list of suppliers or factories, "our factories", a supply chain map or a supplier map. The first such link gives `evidence.supplier_list_found`; excerpt = the link text and target.

## 6. Archived claims: claim removed (axis: track record)

Differentiator A. Deterministic; no LLM is involved in Phase 4 (`llm_used: false`). Code: `src/lib/wayback/`; parameters: `config/wayback.json`.

1. **Pages.** Up to `maxPages` (3) pages per run: sustainability-type pages that robots.txt did not let us fetch live come first (brief Section 8: rely on the archive for those), then the fetched sustainability-type pages in fetch order.
2. **Snapshots.** For each page the Wayback CDX API is asked `https://web.archive.org/cdx/search/cdx?url=<page>&output=json&filter=statuscode:200&collapse=timestamp:4&from=<current year − 8>`. One capture per calendar year is kept for the last 8 years. Because of `collapse=timestamp:4` the archive normally lists one capture per year (the year's first); if it lists several, the newest is kept. Each is fetched raw with `https://web.archive.org/web/<timestamp>id_/<url>` and reduced to visible text exactly like a live page (Section 1: navigation, header, footer and sidebars stripped). Requests to web.archive.org are at least 1,000 ms apart; snapshots are cached forever (an archived copy never changes).
3. **Diff.** Consecutive snapshots of the same page are split into sentences (Section 1) and compared with a sentence-level array diff. Sentences that differ only in case, spacing, quote style or closing punctuation are the same sentence.
4. **Removed claim.** A sentence of the earlier snapshot that is missing from the later one is a removed claim only when **both** hold:
   - one of the claim-language rules of Section 2 matches it (same rules and next-sentence context as on live pages), and
   - no sentence of the later snapshot is a near-equivalent: normalised character-bigram similarity (Sørensen–Dice) below `sameClaimSimilarity` (0.8). At or above 0.8 the claim was reworded, moved or put under a heading, which is a redesign, not a removal.
5. **Signal.** Kind `claim.removed`, label "Claim removed between X and Y: present in the X archived copy of the page, absent from the Y copy". Receipt: `source_url` = the `id_` URL of the earlier snapshot, `snapshot_date` = its capture date, `fetched_at` = when we fetched it, `excerpt` = the removed sentence (≤ 300 characters). A claim removed, restored and removed again gives one signal (the first removal).
6. **Timeline.** Every snapshot becomes one row: year, snapshot URL, the claim sentences present, and the claims removed since the previous snapshot of the same page.
7. **What it is not.** A removed sentence is a risk signal, not a finding about why it was removed. Phase 7 may ask an LLM whether a candidate is a redesign or a move and then drop it; it can only remove candidates, never add one.

Examples (fictional test fixtures):
- Hit: 2021 copy "Every Northwind jacket is climate neutral, so you can wear it with a clear conscience." (an `offset` match); the 2024 copy has no sentence within 0.8 similarity ⇒ `claim.removed`, "claim removed between 2021 and 2024".
- Miss (reworded): "We're committed to regenerative farming on every partner farm." ⇒ "We are committed to regenerative farming on every partner farm." (similarity ≥ 0.8).
- Miss (new markup): "Our oat drinks are carbon neutral." inside a paragraph ⇒ the heading "Our oat drinks are carbon neutral" (same sentence once punctuation is ignored).

If web.archive.org cannot be reached (network error, HTTP 429 or 5xx, or no CDX answer for any page), the step is shown as `skipped: Wayback unreachable (<status>)` and listed under "What we could not check"; it never ends silently.

## 7. Weights

Placeholder until Phase 6. Every Phase 3 signal carries `weight_hint: 1`; the points per kind, the axis weights (claims 25%, evidence 25%, track record 30%, ownership & repair 20%), caps and confidence rules will live in one file, `config/weights.json`, and this section will be generated from it and checked by `tests/unit/score/methodology-sync.test.ts`.

## 8. Known limits of these rules

- Phrase lists, not understanding: a sentence quoting someone else, or criticising a practice, can match. Every match is shown with its sentence so a reader can judge it.
- Same-page substantiation only (Section 3); PDFs are not read.
- English only.
- Pages that need JavaScript to show their text are not seen (Phase 2 skips them with a reason).
- Archived claims: one snapshot per year, so a claim that appeared and vanished within one year is not seen; a claim that moved to another page counts as removed from this page; only up to three pages per brand are looked up.
