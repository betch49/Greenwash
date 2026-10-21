# Greenwash Radar — Methodology

Version 1 (Phase 3; scoring added in Phase 6). This document describes how Greenwash Radar turns fetched pages into greenwashing risk signals. A signal is a pointer to text a brand published, with a receipt: the page URL, the date we fetched it, and the excerpt. **Signals, not verdicts.** Nothing here decides whether a claim is true; the rules only say whether a sentence uses a known risky pattern and whether supporting detail appears next to it on the same page.

Everything in this document is deterministic. No language model is involved in any rule below, and every signal they produce has `llm_used: false`. The score (Section 11) is computed from these signals with the numbers of `config/weights.json` (Section 7); no language model output is ever a number in it.

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
- **ClaimStats**: per rule, the number of matches and of unsupported matches, and both per 1,000 words (`matches × 1000 / words`). Repeated sentences count every time they occur, so a page duplicated three times has the same rates as the page once. A run's stats are the sums over its pages, with rates recomputed over the total word count. These counts are the claims-axis input of the score (brief Section 4, ADR-015; Section 11.4).

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

Differentiator A. Detection is deterministic (`llm_used: false`); Phase 7 lets an LLM classify each detected removal, within the rule of Section 12.2. Code: `src/lib/wayback/`; parameters: `config/wayback.json`.

1. **Pages.** Up to `maxPages` (3) pages per run: sustainability-type pages that robots.txt did not let us fetch live come first (brief Section 8: rely on the archive for those), then the fetched sustainability-type pages in fetch order.
2. **Snapshots.** For each page the Wayback CDX API is asked `https://web.archive.org/cdx/search/cdx?url=<page>&output=json&filter=statuscode:200&collapse=timestamp:4&from=<current year − 8>`. One capture per calendar year is kept for the last 8 years. Because of `collapse=timestamp:4` the archive normally lists one capture per year (the year's first); if it lists several, the newest is kept. Each is fetched raw with `https://web.archive.org/web/<timestamp>id_/<url>` and reduced to visible text exactly like a live page (Section 1: navigation, header, footer and sidebars stripped). Requests to web.archive.org are at least 1,000 ms apart; snapshots are cached forever (an archived copy never changes).
3. **Diff.** Consecutive snapshots of the same page are split into sentences (Section 1) and compared with a sentence-level array diff. Sentences that differ only in case, spacing, quote style or closing punctuation are the same sentence.
4. **Removed claim.** A sentence of the earlier snapshot that is missing from the later one is a removed claim only when **both** hold:
   - one of the claim-language rules of Section 2 matches it (same rules and next-sentence context as on live pages), and
   - no sentence of the later snapshot is a near-equivalent: normalised character-bigram similarity (Sørensen–Dice) below `sameClaimSimilarity` (0.8). At or above 0.8 the claim was reworded, moved or put under a heading, which is a redesign, not a removal.
5. **Signal.** Kind `claim.removed`, label "Claim removed between X and Y: present in the X archived copy of the page, absent from the Y copy". Receipt: `source_url` = the `id_` URL of the earlier snapshot, `snapshot_date` = its capture date, `fetched_at` = when we fetched it, `excerpt` = the removed sentence (≤ 300 characters). A claim removed, restored and removed again gives one signal (the first removal).
6. **Newest archived copy vs the live page (ADR-017).** When a page was fetched live and has at least one archived copy, the live page is the last element of its history: year = the run's year, URL = the page URL, marked as the current page in the timeline. The same diff and the same two conditions apply. A claim in the newest archived copy that the live page no longer has (no sentence within 0.8 similarity) ⇒ `claim.removed`, label "Claim removed between <year> and the current page: present in the <year> archived copy, absent from the page as fetched on <date>"; receipt = the newest archived copy's `id_` URL and capture date (the live page is never the receipt for a removal). A page robots.txt keeps us from fetching has no live text and gets no live comparison.
7. **Timeline.** Every snapshot becomes one row: year, snapshot URL, the claim sentences present, and the claims removed since the previous snapshot of the same page; the live page, when compared, is the last row.
8. **What it is not.** A removed sentence is a risk signal, not a finding about why it was removed. Phase 7 asks an LLM whether a removal is a redesign or a move and may then drop it (Section 12.2); it can only keep, halve or drop a removal, never add one.

Examples (fictional test fixtures):
- Hit: 2021 copy "Every Northwind jacket is climate neutral, so you can wear it with a clear conscience." (an `offset` match); the 2024 copy has no sentence within 0.8 similarity ⇒ `claim.removed`, "claim removed between 2021 and 2024".
- Hit (live page): 2025 copy "Our dyes are eco-friendly and kind to rivers." (a `vague` match); the page as fetched on 2026-10-20 has no such sentence ⇒ "claim removed between 2025 and the current page".
- Miss (reworded): "We're committed to regenerative farming on every partner farm." ⇒ "We are committed to regenerative farming on every partner farm." (similarity ≥ 0.8).
- Miss (new markup): "Our oat drinks are carbon neutral." inside a paragraph ⇒ the heading "Our oat drinks are carbon neutral" (same sentence once punctuation is ignored).

If web.archive.org cannot be reached (network error, HTTP 429 or 5xx, or no CDX answer for any page), the step is shown as `skipped: Wayback unreachable (<status>)` and listed under "What we could not check"; it never ends silently.

## 7. Weights

Generated from `config/weights.json` (version 1) by `weightsMarkdown()` in `src/lib/score/methodology.ts`; `tests/unit/score/methodology-sync.test.ts` fails if this section and the file differ. The /methodology page renders the same tables from the same file.

### Axis weights

| Axis | Weight | Cap |
|---|---|---|
| `claims` (Claim language) | 25% | 100 |
| `evidence` (Evidence & certifications) | 25% | 100 |
| `track` (Track record) | 30% | 100 |
| `repair` (Ownership & repair) | 20% | 100 |

### Points per signal kind

| Axis | Kind | Points |
|---|---|---|
| `claims` | `claim.unsupported` | 1 |
| `claims` | `claim.supported` | 0.25 |
| `evidence` | `evidence.no_report_found` | 40 |
| `evidence` | `evidence.stale_report` | 25 |
| `evidence` | `evidence.report_found` | 0 |
| `evidence` | `evidence.report_found_undated` | 0 |
| `evidence` | `evidence.absolute_emissions_found` | 0 |
| `evidence` | `evidence.supplier_list_found` | 0 |
| `track` | `claim.removed` | 20 |
| `track` | `regulator.ruling` | 25 |
| `track` | `regulator.ruling_other_topic` | 0 |
| `track` | `regulator.ruling_not_upheld` | 0 |
| `repair` | `repair.no_repair_info_found` | 50 |
| `repair` | `repair.manual_found` | 0 |
| `repair` | `repair.spare_parts_found` | 0 |
| `repair` | `repair.program_found` | 0 |
| `repair` | `repair.warranty_found` | 0 |
| `repair` | `repair.ifixit_devices` | 0 |
| `repair` | `repair.ifixit_guides` | 0 |
| `repair` | `repair.ifixit_score` | 0 |

### Other parameters

| Parameter | Value |
|---|---|
| `claimsRate.perWords` | 1000 |
| `claimsRate.minWords` | 1000 |
| `claimsRate.subscorePerPointPer1000Words` | 15 |
| `claimsRate.version` | 1 |
| `claimsRate.v2.minClaims` | 5 |
| `claimsRate.v2.insufficientDataStatus` | insufficient_data |
| `defaultWeightHint` | 1 |
| `regulatorRuling.baseHint` | 1 |
| `regulatorRuling.upheldMultiplier` | 2 |
| `regulatorRuling.recentYears` | 3 |
| `regulatorRuling.recentMultiplier` | 1.5 |
| `llmGuard.maxShare` | 0.5 |
| `llm.unsureWeightMultiplier` | 0.5 |
| `labels.moderateFrom` | 25 |
| `labels.highFrom` | 50 |
| `confidence.axisSteps.claims` | claims |
| `confidence.axisSteps.evidence` | evidence |
| `confidence.axisSteps.track` | wayback, asa-uk, jdp-fr |
| `confidence.axisSteps.repair` | repair |
| `confidence.timelineCountsAsData` | track |

## 8. Known limits of these rules

- Phrase lists, not understanding: a sentence quoting someone else, or criticising a practice, can match. Every match is shown with its sentence so a reader can judge it.
- Same-page substantiation only (Section 3); PDFs are not read.
- English only.
- Pages that need JavaScript to show their text are not seen (Phase 2 skips them with a reason).
- Archived claims: one snapshot per year, so a claim that appeared and vanished within one year is not seen; a claim that moved to another page counts as removed from this page; only up to three pages per brand are looked up.

## 9. Regulator rulings (axis: track record)

Differentiator C (ADR-003). Deterministic; no LLM (`llm_used: false`). Code: `src/lib/regulators/`; parameters: `config/regulators.json`, `config/weights.json` (`regulatorRuling`). Every regulator page goes through the robots.txt guard, at most one request per second per host.

1. **Search.** The brand name without its legal suffix ("Oatly AB" ⇒ "Oatly") is searched on
   - UK ASA: `https://www.asa.org.uk/search.html?q=<brand>`; only hits linking to `/rulings/…html` are kept (news and guidance pages are ignored);
   - France JDP: `https://www.jdp-pub.org/avis/?search_avis=<brand>` (the search box of the decisions listing); hits link to `/avis/<slug>/`.
2. **Which hits are read.** A hit whose listed name does not contain the brand as a whole word is never fetched (search engines also return full-text hits about other advertisers). Hits whose name matches are read first, then possible matches, at most `maxRulings` (5) ruling pages per regulator.
3. **Ruling page.** ASA: advertiser = the text after "ASA Ruling on" in the page heading; outcome and date = the line under it. JDP: advertiser = the page heading (decisions are titled by advertiser); outcome = the heading that names one; date = "Avis publié le <date>". Excerpt = the first 300 characters of the ruling text (ASA from "Background"; JDP from "1. La plainte").
4. **Outcome.** ASA "Upheld" ⇒ upheld; "Upheld in part" ⇒ upheld, with that note; "Not upheld" ⇒ not upheld; "Informally resolved" ⇒ informally resolved. JDP "partiellement fondée" ⇒ upheld, with that note; "non fondée" or "rejetée" ⇒ not upheld; "fondée" ⇒ upheld (checked in that order, so "Plainte fondée / Demande de révision rejetée" is upheld). The label always shows the outcome words as the regulator published them.
5. **Matching (conservative).** Both names are normalised: lowercase, diacritics and punctuation removed, "&" ⇒ "and", trailing legal suffixes removed (Inc, Ltd, SA, GmbH, BV, AB, …) and trailing geographic or structural qualifiers removed (UK, Europe, France, International, Holdings, …). The advertiser is split on "t/a" / "trading as".
   - **scored**: one of the advertiser's names equals the brand (spacing ignored: "TOTAL ENERGIES" ≡ "TotalEnergies"). Example: "Shell" and "Shell UK Ltd t/a Shell".
   - **possible**: the brand is a whole word of the title or advertiser, but another word is part of the name: "Shell Energy UK", "Patagonia Provisions Ltd", "Acme Widgets". Shown under "What we could not check" with the entity verbatim; never a signal, never scored.
   - **none**: not even a whole word ("Pata" in "Patagonia").
6. **Signal.** Kind `regulator.ruling`, label "Ruling found naming <entity verbatim> (<regulator>, <country>, <date>); outcome as published: <words>", `entity_name` = the advertiser verbatim, receipt = the ruling page. `weight_hint` = `baseHint` × `upheldMultiplier` when upheld × `recentMultiplier` when the ruling is dated within `recentYears` of the run (values in `config/weights.json`). The ruling's points are the `regulator.ruling` points of Section 7 × this hint (Section 11).
7. **Coverage.** Every report says that only the UK ASA and the French JDP were searched. A site that is unreachable, disallows the page in robots.txt or serves a page we cannot parse ends its step as `skipped: <reason>` (for example `skipped: ASA unreachable (HTTP 500)`); the other regulator still runs.

9.7. **Topic gate (ADR-033, Phase 14).** A ruling whose ruled entity is the brand is scored as `regulator.ruling` only when its topic is environmental: the regulator's own topic line when the page publishes one (no v1.1 adapter reads one yet), else a whole-word match of the lexicon `environmentalTopic.terms` in `config/regulators.json` (EN and FR; a trailing `*` matches any word ending) against the ruling title and the fetched ruling text (`src/lib/regulators/topic.ts`). Otherwise the ruling is listed with its receipt as `regulator.ruling_other_topic`, 0 points, labelled "ruling on another topic (topic not established as environmental)". Possible matches are unchanged. Example: the JDP "Heures Eco" electricity-price decision naming TotalEnergies is listed, not scored.

9.8. **Not upheld (QA-2, Phase 14; builder decision pending the director's ruling).** An environmental ruling whose outcome is not upheld ("Plainte rejetée", "Not upheld") is listed as `regulator.ruling_not_upheld`, 0 points, labelled "complaint not upheld (outcome as published: …)". The 9.6 weight hint applies to upheld rulings only.

## 10. Ownership and repair (axis: ownership & repair)

Differentiator E. Deterministic; no LLM. Code: `src/lib/repair/`; parameters: `config/repair.json`, `config/discovery.json` (`nonDurableIndustries`).

1. **Applicability.** When the confirmed Wikidata entity's industry (P452) is in `nonDurableIndustries` (food, beverage, dairy, …), the axis is **not applicable**: no repair check runs, no signal is produced, the step reads `skipped: not applicable: …`, and "What we could not check" says the axis is not scored. A brand with no industry on record (or reached through the URL fallback) is treated as durable.
2. **Brand pages.** The rules read every fetched page (the discovery heuristics already try `/repair`, `/warranty` and `/support`): each visible text line and each link text, navigation links included. One protective signal per rule, from the first page in fetch order where it matches:
   - `repair_manual` ⇒ `repair.manual_found`: "repair guide(s)", "repair tutorial(s)", "service manual(s)", "repair manual(s)".
   - `spare_parts` ⇒ `repair.spare_parts_found`: "spare part(s)", "replacement part(s)", "parts store", "parts shop".
   - `repair_program` ⇒ `repair.program_found`: "repair program(me)", "repair service(s)", "we repair", "send it in for repair", "send it / your device (in) to our repair or service centre".
   - `warranty_years` ⇒ `repair.warranty_found`, the longest warranty stated on any page: "<n>-year warranty" / "<n> year limited warranty" / "five-year warranty" (numbers in words up to thirty), "warranty of <n> years" / "guarantee period of up to <n> years", the same with "guarantee" for "warranty", and "lifetime warranty" (⇒ `lifetime`).
3. **Nothing found.** If no rule matches on any fetched page of an applicable brand: one `repair.no_repair_info_found` risk signal; receipt = the first page; excerpt = every page scanned (title and URL).
4. **iFixit.** The brand's device category is read from `https://www.ifixit.com/api/2.0/wikis/CATEGORY/<brand>` (iFixit's robots.txt allows `/api/2.0/wikis*` and disallows `/api/2.0/search`, so the search endpoint is not used; `docs/CHALLENGES.md` C-2). Its title must equal the brand's name after normalisation (Section 9.5), else nothing is attributed. Signals, all protective, receipt = the API response: `repair.ifixit_devices` (device categories listed, names in the excerpt), and for the last `maxDevices` (3) device categories listed: `repair.ifixit_guides` (guide count, first guide titles in the excerpt) and `repair.ifixit_score` when iFixit publishes a repairability score. No category ⇒ a "could not check" line; iFixit unreachable ⇒ a "could not check" line; the page rules still run.
5. **Not covered in v1.** Anti-repair practices (serialised parts, warranty-void stickers, lawsuits) have no structured public source (`docs/LATER.md`).

## 11. From signals to a score

Code: `src/lib/score/` (`weights.ts` reads and validates `config/weights.json`, `scorer.ts`, `ai-share.ts`, `confidence.ts`, `report.ts`). Tests: `tests/unit/score/`. Every number used below is a parameter of Section 7, named here by its key; `tests/unit/score/no-magic-numbers.test.ts` fails if `scorer.ts`, `ai-share.ts` or `confidence.ts` contain a numeric literal other than 0, 1 or 100.

1. **Receipts first.** A signal without a source URL, an ISO fetch date and a non-empty excerpt is rejected before scoring (in development the scorer throws; in production it drops and logs the signal). A rejected signal never appears in the report.
2. **Points.** A signal is worth the points of its kind (Section 7, "Points per signal kind") × its `weight_hint`. The hint is `defaultWeightHint` for every rule-based signal except rulings (Section 9.6). A kind with no entry is worth 0. All points are 0 or more.
3. **Risk points only.** A protective signal (a report, an emissions figure, a supplier list, a repair manual, spare parts, a repair service, a warranty, iFixit guides or score) is worth 0 points: it is listed with its receipt and it is data for confidence. Protective findings lower a sub-score by taking the place of the risk signal that is emitted when nothing is found (`evidence.report_found` instead of `evidence.no_report_found`; any repair finding instead of `repair.no_repair_info_found`). This keeps the brief's rule exact: removing any signal can never raise a score.
4. **Sub-scores (0–100).** For the evidence, track and repair axes, the sum of the axis's points, capped at the axis cap. For the claims axis the input is a rate built from the run's ClaimStats (Section 4; a repeated sentence counts every time it occurs): unsupported matches × the `claim.unsupported` points + the other (supported) matches × the `claim.supported` points, per `claimsRate.perWords` visible words of the fetched pages (at least `claimsRate.minWords` words are counted, so a short page cannot inflate the rate), × `claimsRate.subscorePerPointPer1000Words`, capped. `claim.supported` is worth less than `claim.unsupported` (ADR-015). Claim signals produced with an LLM (Phase 7) are not in ClaimStats; they are added to the rate by their own points and count as the axis's LLM part (item 10).
   **Claims formula versions (Phase 14, ADR-030).** `claimsRate.version` selects the claims-axis formula; the value in Section 7 is the active one (the director flips it, ADR-032).
   - **v1 (density, the formula above).** Risky-phrase points per `claimsRate.perWords` words. A page with no claim sentence scores 0 on the axis.
   - **v2 (share).** Let `m` be the matched claim sentences (ClaimStats matches plus LLM-only claim signals), `u` the unsupported ones and `s` the supported ones. If `m` is below `claimsRate.v2.minClaims`, the axis status is `insufficient_data`: it contributes 0, lowers confidence like a skipped step, and the report says "Fewer than N environmental claim sentences were found on the fetched pages; the claim-language axis was not scored." Otherwise the sub-score is 100 × (`u` + `supportedWeight` × `s`) ÷ `m`, capped, where `supportedWeight` = `claim.supported` ÷ `claim.unsupported` points (0.25; read from the points, not duplicated). The LLM part is the share over every sentence minus the share over the rule-based sentences alone. Known property: in a share, a supported sentence is protective, so removing one can raise the sub-score (documented with its counter-example in `tests/unit/score/monotonic.test.ts` and `docs/phases/14.md`); v1 keeps the strict "removing a signal never raises the score" property.
5. **Weighted sum.** Score = Σ axis weight × sub-score, rounded. Example: sub-scores 40, 20, 80, 10 with the weights 25%, 25%, 30%, 20% ⇒ 10 + 5 + 24 + 2 = 41.
6. **Not applicable.** When the repair axis is not applicable (Section 10.1), its weight is shared out among the other axes in proportion to their weights (each weight ÷ the sum of the applicable weights), and confidence is not lowered.
7. **Missing data.** An axis with no signal contributes 0. Missing data never adds points; it lowers confidence instead.
8. **Confidence (0–100).** The share of (effective) axis weight whose axis has data: at least one of its steps (`confidence.axisSteps`) finished `done`, not skipped, and the axis produced at least one receipted signal (for the axes in `confidence.timelineCountsAsData`, an archived snapshot read for the timeline also counts). Shown as "Score 62, confidence 40%".
9. **Label.** "Low signals" below `labels.moderateFrom`, "Moderate signals" from `labels.moderateFrom`, "High signals" from `labels.highFrom`. With it: "Based on N verified signals from M sources.", where M is the number of distinct hosts of the signals' source URLs.
10. **AI share and its guard (ADR-007).** Each signal records whether an LLM call produced it (`llm_used`). Per axis, the non-LLM sub-score is computed from the non-LLM signals alone; what the LLM signals add on top of it is the axis's LLM part. `ai_share` = weighted LLM points ÷ score. If LLM points would exceed `llmGuard.maxShare` of the score, they are scaled down until they are exactly that share (with 50%: equal to the non-LLM points); with no non-LLM points, LLM signals add nothing and `ai_share` is 0. Formally, score = min(Σ weight × sub-score, non-LLM points ÷ (1 − `llmGuard.maxShare`)). The config cannot set `maxShare` above the brief's 50% (schema check), and a property test over 1,000 random signal sets fails if `ai_share` ever exceeds 0.5. The report lists `llm_signal_ids` and, since Phase 7, `llm_calls` (one entry per LLM call: task, whether a recorded fixture answered, outcome). Which signals are LLM-assisted is defined in Section 12.
11. **Report.** The result is stored as `ReportV1` (`src/lib/score/report.ts`, zod): brand, website, score, label, confidence, `ai_share`, `llm_signal_ids`, the four axes with weight, effective weight, status (`scored`, `missing`, `not_applicable`), sub-score and signals, the timeline, "What we could not check", the skipped steps, the generation time and the signal and source counts.

## 12. AI-assisted steps (Phase 7)

The LLM is used for exactly three things (brief Section 1), and it never produces a number that enters the score. Code: `src/lib/llm/`, `src/lib/pipeline/steps/llm.ts`; parameters: `config/llm.json` (model, effort, page and item limits) and `config/weights.json` (`llm.unsureWeightMultiplier`).

**Every call.** One request per task through the official Anthropic SDK, with one strict tool whose input schema is the task's schema (`additionalProperties: false`), automatic tool choice, and a system prompt that allows the model to use only the text it is given and to mention only URLs from the list it is given. The model id is `config/llm.json` `model` unless `GR_LLM_MODEL` is set. Every output is validated: an item with an extra field or a wrong type is dropped; a payload that is not the expected object is rejected as a whole, the step shows `skipped: … AI output rejected (<why>)`, and the rule-based result stands. A failed call or a declined request is shown the same way. Without `ANTHROPIC_API_KEY` (outside offline fixture mode) the three steps show `skipped: LLM unavailable (no API key)`, "What we could not check" says so, and the report is built from the rule-based signals.

1. **Candidate claims** (step "Proposing candidate claims (AI)", after the claim-language engine). For up to `extract.maxPages` fetched pages (sustainability-type pages first), the model gets the page's visible text and the list of fetched URLs and proposes claim sentences. A proposal is kept only if (a) it is a verbatim substring of the page text (whitespace ignored), (b) a claim-language rule of Section 2 matches it, with the same next-sentence and brand context as in the page scan, and (c) the rules did not already find it (no rule-found sentence contains it or is contained in it). Only then is it a signal: the same kinds and labels as Section 4, receipt = the page it came from, `llm_used: true`. A proposal the rules had already found adds nothing; the rule-based signal keeps `llm_used: false`. LLM-found sentences are not added to the claim counts (ClaimStats); the scorer adds their points once, on top of the rule-based rate, as the axis's LLM part (Section 11.4, 11.10).
2. **Archived-change classification** (step "Classifying archived changes (AI)", after the Wayback diff). The human-readable rule that caps its influence:
   - The model only sees removals the deterministic detector of Section 6 found, with the sentence and a few sentences of context from both copies (no URL). It answers `claim_removed`, `redesign`, `moved` or `unsure`.
   - `redesign` or `moved` ⇒ the removal is dropped (its signal and its timeline line).
   - `claim_removed` ⇒ kept, receipt unchanged, marked AI-assisted (`llm_used: true`).
   - `unsure` ⇒ kept, AI-assisted, `weight_hint` × `llm.unsureWeightMultiplier` (0.5; the schema keeps it at or below 1, so the LLM can only lower a removal's weight).
   - No answer, an invalid answer or a failed call ⇒ the removal stands as the rules found it (`llm_used: false`).
   - The classifier can never add a removal, and every removal it keeps counts as AI points under the 50% guard (Section 11.10).
3. **Summary** (step "Writing the plain-English summary (AI)", after scoring). The model gets the scored report (without run ids or times) and the list of URLs the run fetched (pages, signal receipts, archived copies). The summary is shown only if every URL in its text and in its `cited_urls` is in that list, it passes the wording filter of ADR-008, and it is at most `summary.maxWords` (120) words. Otherwise the report shows "Summary unavailable". The summary is text only: it changes no number.

**Offline and tests.** With `GR_OFFLINE_FIXTURES=1` the client is `MockLLM`, which answers from `fixtures/llm/<task>-<sha1(input).slice(0,12)>.json` and returns nothing (an empty result) for an input it has no file for. No API key was available while building v1, so the files there are hand-authored stand-ins written by `scripts/author-llm-fixtures.ts` and say so in their `source` field; with a key, `GR_RECORD_LLM=1` records real answers in their place. With those fixtures: Mammut, Fairphone and Oatly have `ai_share` 0 (every proposed claim was already found by the rules; no archived history, so nothing to classify), and the fictional Northwind has `ai_share` 9/34 ≈ 0.26 (its two removals, one confirmed and one `unsure`, are AI-assisted).

**Temperature.** The brief asks for temperature 0. The current models (`claude-sonnet-5-5`, the default, and the other 5.5 models) reject sampling parameters, so temperature 0 is sent only to models listed in `config/llm.json` `temperatureModels`; reproducibility comes from the strict schema, the validation above and the recorded fixtures (`docs/CHALLENGES.md` C-5).

## 13. Validation (evaluation only)

**Ground-truth labels are used for evaluation only and never enter the score.** They live in `fixtures/validation/ground-truth.json` (`label_use: "evaluation_only"`), are read by `src/lib/validation/` and nothing else under `src/`, and that module is imported only by `scripts/validate.ts` and the tests (`tests/unit/validation/isolation.test.ts` scans the import graph). The pipeline receives a brand name, a website and a Wikidata entity, exactly as from the confirm screen, never a label. Weights are not fitted to the labels: a weight change is a value stated in `docs/PLAN.md` before it is measured, and the harness reports the result (ADR-025).

**What the ground truth is.** One entry per brand, each with dated citations that the recorder (`npm run record:validation`, `scripts/record-validation.ts`) fetched from the build container with the app's User-Agent, robots.txt checks and one request per second per host; the copies are under `fixtures/validation/citations/`, and each citation's one-line "why" is written from what the fetched page says. Source rules are in `docs/SOURCES.md` ("how an entry is made").

- **Flagged:** at least one citation from a credible third party: Changing Markets' brand archive (its "wash by brand" index; a campaign publication), an upheld ASA or JDP ruling on an environmental claim, or an SBTi "Commitment Removed" row whose reason is not "Target set at parent company level" or "Company change". NewClimate's monitor answers 403 from the build container and Sabin case search is client-side only, so no entry relies on either.
- **Well-rated:** no flag found, plus two positive markers from different sources: SBTi "Validated Targets" on both the near-term and the net-zero target, and a Net Zero Tracker record with an interim target and a published plan. "No flag found" means the brand is not in the Changing Markets index, the SBTi row is not a removal, and the ASA and JDP searches list no ruling naming the brand (any ruling naming it rules the label out, whatever its topic; so does a JDP decision listed without an advertiser name). This is a weak label by construction: "no credible flag found", not "proven honest". The well-rated group is also mostly business-to-business and telecom companies, while the flagged group is mostly consumer brands; part of any separation may come from that difference.
- **Contested:** a flag plus two positive markers. Listed and run when possible, never in the statistics.

**How separation is computed** (`src/lib/validation/stats.ts`). Only brands whose run produced a report from at least one fetched page are in the sample; a run that fails, or that could fetch no page, is counted as failed with its reason. AUC is the Mann–Whitney statistic: the share of (flagged, well-rated) pairs in which the flagged brand has the higher score, ties counted one half (1 = perfect separation, 0.5 = none, 0 = reversed). Also reported: mean and median score difference, AUC per axis over the brands where that axis was scored, and the "saying less scores better" diagnostic, the Spearman rank correlation (ties averaged) between words scanned and score and between claim-rule matches and score. The leakage line counts the flagged entries whose flags all come from sources the pipeline itself queries (ASA, JDP), because for those the score and the label share an input.

**Where results live.** `npm run validate -- --mode offline` runs the ground-truth brands that have a recorded brand fixture (no network, pinned clock); `--mode live` runs every brand through the live services and records per-brand coverage. Each run writes `docs/validation/results-<date>-<mode>.json` and regenerates `docs/validation/RESULTS.md` (history of every run, then the latest offline and live runs in detail, with the sentence "Partial run: N of M brands produced a report" when not every brand did).
