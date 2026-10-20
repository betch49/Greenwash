# Wikidata fixtures

Real responses from `https://www.wikidata.org/w/api.php`, recorded on 2026-10-20 with
`npm run record:wikidata -- <query…>` (see `scripts/record-wikidata.ts`). Offline mode
(`GR_OFFLINE_FIXTURES=1`) and the unit tests read them through `FixtureFetcher`;
`src/lib/wikidata/fixtures.ts` maps each API URL to its file:

| File pattern | API call |
|---|---|
| `search-<query>.json` | `wbsearchentities` (limit 7, English) |
| `entities-<ids or hash>.json` | `wbgetentities` for the search hits (`labels|descriptions|aliases|claims`) |
| `classes-<ids or hash>.json` | `wbgetentities` for the hits' P31 classes (`labels|claims`, used for one level of P279) |
| `labels-<ids or hash>.json` | `wbgetentities` labels for referenced industry / country / parent items |

`<ids>` is the sorted id list joined with `_` when there are at most 6 ids, otherwise `h` +
the first 12 hex characters of the SHA-1 of the `|`-joined sorted ids.

Queries recorded: `patagonia`, `acme`, `continental`, `fairphone`, `oatly` (Phase 1), and `mammut`,
`mammut sports group` (Phase 2 rework, 2026-10-20). Plain `mammut` returns the extinct genus and other
non-companies (no confident match, no candidates), which is why the Mammut brand fixture uses `mammut sports group`.
