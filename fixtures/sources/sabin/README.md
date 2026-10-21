# Sabin Center climate litigation fixtures (Phase 13, ADR-028)

Real recorded pages of the Sabin Center for Climate Change Law's Climate Litigation Database on
`www.climatecasechart.com`, served offline by `src/lib/fetch/source-fixtures.ts` through this directory's own
`manifest.json` (URL ⇒ file relative to this directory, and capture time served as `fetched_at`).

Recorded on 2026-10-21 with `npm run record:sabin` (`scripts/record-sabin.ts`): robots.txt checked before every
request, 1 request per second, `GreenwashRadar/0.1 …` User-Agent, normal TLS verification through the container's
proxy CA. Only `/geographies/<slug>` and `/document/<slug>` pages (and `/robots.txt`) were requested.

**Changes made at capture time.** Inline `<script>` bodies are removed, except the server-rendered `__NEXT_DATA__`
JSON the parser reads; from it `envConfig` (the app's API token and keys), `themeConfig` and `familyTopics`
(concept counts) are dropped. Each HTML file starts with `<!-- real capture: <url> on <date> … -->`.

| File(s) | What | Why |
|---|---|---|
| `geographies-{switzerland,netherlands,sweden}.html` | The 4 newest families listed for each country | countries of Mammut, Fairphone, Oatly (Wikidata P17) |
| `geographies-{france,united-kingdom}.html` | Same, France and the United Kingdom | TotalEnergies / BlackRock (France), Shell (UK) |
| `geographies-united-states-of-america.html` | Same, US | read for every brand (PLAN Phase 13 deliverable 2) |
| `document-greenpeace-france-and-others-v-totalenergies-se-…-3e1f.html` | *Greenpeace France and Others v. TotalEnergies SE and TotalEnergies Electricité et Gaz France* (Decided, filed 2022) | criterion 13.3 on a real capture: party "TotalEnergies SE" ⇒ scored for "TotalEnergies" |
| `document-clientearth-v-blackrock-51f1.html` | *ClientEarth v. BlackRock* (Pending, filed 2024) | scored for "BlackRock"; also on the France listing (dedup) |
| `document-milieudefensie-et-al-v-royal-dutch-shell-plc-c3e4.html` | *Milieudefensie et al. v. Royal Dutch Shell plc.* (Pending) | real `possible` path for "Shell" |
| `document-clientearth-v-shells-board-of-directors-9377.html` | *ClientEarth v. Shell’s Board of Directors* (Decided) | real `possible` path for "Shell" |
| `robots-www-climatecasechart-com.txt` | robots.txt | the offline run checks it like the live one |
| `index.json` | Seed index: the 4 document URLs above, with `recorded_at` and `recorded_from` | discovery only; every entry is re-fetched and re-matched on its page title, never trusted |
| `synthetic/*.html` | **Hand-built** pages for the fictional brands Northwind (possible) and Quillmoor (dismissed ⇒ 0 points) | ADR-011: synthetic only for `.example` brands; used by unit tests only, not in the manifest, never served offline |

Three seed URLs were found by following the site's own permanent redirects from the cases' legacy URLs
(`/non-us-case/<slug>/` ⇒ 301 ⇒ `/document/<slug>_<id>`), one on the France listing; `recorded_from` says which.
The guard test is `tests/unit/registries/sabin-fixtures.test.ts`.
