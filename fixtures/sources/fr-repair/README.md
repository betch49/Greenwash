# French repairability index fixtures (Phase 12)

Real captures from data.gouv.fr made on 2026-10-21 by `npm run record:registries -- fr-repair`
(`scripts/registries/fr-repair.ts`), which runs `src/lib/registries/fr-repair.ts` itself: robots.txt checked
before every request, 1 request per second per host, `GreenwashRadar/0.1 …` User-Agent, normal TLS verification
through the container's proxy CA, up to 6 tries with exponential backoff (data.gouv.fr resets connections from this
egress). Served offline by `src/lib/fetch/source-fixtures.ts` from `manifest.json` (URL ⇒ file relative to this
directory, capture time served as `fetched_at`). Nothing here is hand-written (ADR-011); guard test
`tests/unit/registries/fr-repair-api.test.ts`.

| File | What |
|---|---|
| `api/datasets-page-1.json`, `api/datasets-page-2.json` | `GET /api/1/datasets/?q=indice de reparabilite&page_size=100` and its `next_page`. 125 results reported, 115 distinct (the pages overlap). **Trimmed** to the fields the module reads (id, slug, title, page, licence, organisation, owner, resources); the manifest records each original body's size and sha256 (911,515 and 145,918 bytes). |
| `csv/tabular-5207fe39-….csv` | Fairphone's dataset (Licence Ouverte 2.0) through data.gouv.fr's tabular API CSV export: 6 rows, `note_ir` 9.3, `date_calcul` 2025-06-25. The resource URL on `static.data.gouv.fr` is disallowed by robots.txt (`Disallow: /resources`) and was not fetched (`docs/CHALLENGES.md` C-12.1). |
| `robots/www-data-gouv-fr.txt`, `robots/static-data-gouv-fr.txt` | robots.txt of both hosts (same file). `tabular-api.data.gouv.fr/robots.txt` answered 404 (no restriction) and is therefore not recorded; offline it is served as 404 too. |

Cases recorded (`manifest.json` `cases`): Mammut (no dataset), Fairphone (open licence, the scored case), Electrolux
(`ELECTROLUX FRANCE`, licence `notspecified`: the gated case, CSV never fetched), Bosch (`Robert Bosch France SAS`,
`notspecified`: the possible-match case). Oatly is a drinks brand, so the repair axis does not apply. The ground-truth
brands of Phase 10 are not recorded here (Phase 10 is built in parallel); the API pages are brand-independent, so any
brand's matching runs offline, but a CSV of another open dataset would need recording.
