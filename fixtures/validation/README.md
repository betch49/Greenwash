# Validation ground truth (Phase 10)

**Evaluation only (ADR-025).** These labels are read by `src/lib/validation/` (imported only by `scripts/validate.ts`
and the tests); nothing in the pipeline or the scorer reads them (`tests/unit/validation/isolation.test.ts`).

| File | What |
|---|---|
| `candidates.json` | Hand-written input: for each brand, its name, website, Wikidata id where known, the brand fixture if any, and the URLs to cite with their role (`flag` or `positive`). No label and no "why" is written by hand, except the one-line topic of an ASA/JDP ruling, written after reading the stored ruling. |
| `ground-truth.json` | Written by `npm run record:validation` (`scripts/record-validation.ts`): the entries with their group, every citation with `url`, `date` (capture date), `why` (generated from the fetched page), `verified_from_container` and `file`, and, for well-rated entries, the negative `checks`. Schema and rules: `src/lib/validation/ground-truth.ts`, `docs/SOURCES.md`. |
| `citations/` | The recorded copy of every cited page and every check (`<slug>-<n>.html`, `<slug>-check-<source>.html`), plus the Changing Markets brand index. HTML starts with `<!-- real capture: <url> on <date> … -->`; inline script bodies are removed except JSON data blocks (Net Zero Tracker pages keep their `__NEXT_DATA__` record). SBTi citations are `<slug>-<n>.json`: the brand's one row of the companies export, trimmed to the status columns, with the export URL, its `last-modified` header and the fetch time (the 2.3 MB `.xlsx` is not stored). |
| `record-log.txt` | Every request of the last recording and every citation or candidate that was dropped, with the reason. |

## How the recorder decides (no judgement call is left to the label)

- Etiquette: robots.txt checked before every request (fail closed), one request per second per host, the app's
  User-Agent, normal TLS verification. Recorded 2026-10-21 from the build container.
- A citation is kept only if its page was fetched (2xx) and says what its role needs: an SBTi flag must be a
  "Commitment Removed" row whose reason is not "Target set at parent company level" or "Company change"; an SBTi marker
  must have "Validated Targets" for both near-term and net-zero; a Net Zero Tracker marker must have an interim target
  and "published plan: Yes"; an ASA or JDP flag must be an upheld ruling (`parseAsaRuling` / `parseJdpDecision`); a
  Changing Markets page must list at least one case article.
- Group: any flag ⇒ `flagged`, or `contested` when the brand also has two markers from different sources. No flag and
  two markers ⇒ the negative checks run (Changing Markets index, ASA search, JDP search, all recorded). Any ASA or JDP
  ruling naming the brand, whatever its topic, rules the well-rated label out (BT Group: 1 ASA ruling; Vodafone: 8),
  and so does a JDP result listed without an advertiser name (Orange: 6), because it cannot be ruled out.

## Result (2026-10-21)

22 flagged, 20 well-rated, 6 contested. Flags: Changing Markets brand pages (19 brands), SBTi removed commitments
(Amazon, innocent, JBS, Unilever, Asda, HelloFresh), ASA rulings (Oatly, Shell), JDP decisions (TotalEnergies).
Well-rated markers: SBTi validated near-term and net-zero targets plus a Net Zero Tracker interim target with a
published plan.

Not used, and why:

- **NewClimate CCRM** answers 403 from the build container. A citation from memory would be an invented citation, so
  no entry uses it, even though `verified_from_container: false` would be allowed for it.
- **Sabin Center** case search renders client-side and `/_search` is disallowed (ADR-028): it cannot be checked, so no
  entry uses it and the well-rated checks do not include it.
- **Fashion Transparency Index** (PDF reports) and **B Corp** (Cloudflare-challenged) were not needed for the two
  markers and were not used.
- **Changing Markets** pages are campaign publications (SOURCES.md): a flag there is an advocacy organisation's
  assessment, not a ruling.

Known bias: the well-rated group is mostly business-to-business, telecom and industrial companies (Net Zero Tracker
covers large listed companies, and consumer brands with markers are mostly also on the Changing Markets index, hence
contested); the flagged group is mostly consumer brands. A separation figure can partly reflect that difference.

Offline subset (brand fixtures under `fixtures/brands/`): Oatly (v1), innocent and TotalEnergies (flagged), Signify
and Essity (well-rated).
