# SBTi Target Dashboard export (Phase 11)

Real capture of the SBTi companies export, recorded by `npm run record:registries -- sbti`
(`scripts/record-registries.ts`): robots.txt of the export host checked first (it answers 404: no restrictions),
`GreenwashRadar/0.1 …` User-Agent, normal TLS verification through the container's proxy CA, 1 request per second per host.
Served offline for `https://files.sciencebasedtargets.org/production/files/companies-excel.xlsx` by `src/lib/fetch/source-fixtures.ts` through `manifest.json` (capture time = `fetched_at`).

The full file is not committed (ADR-026, ADR-031). `companies-2026-10-21.xlsx` is the export **trimmed** to the rows whose `company_name`
equals or contains as a whole word (ADR-019 rule) one of the names below, plus 50 rows chosen by a fixed-seed generator
(seed 20261021). Every kept row is copied verbatim, all columns, in the export's order.

Terms: SBTi's website terms allow storing the data for non-commercial research use with credit. Source: Science Based
Targets initiative, Target Dashboard export (2026-10-21), https://sciencebasedtargets.org/target-dashboard

## Full export as fetched

| Field | Value |
|---|---|
| URL | https://files.sciencebasedtargets.org/production/files/companies-excel.xlsx |
| Captured | 2026-10-21T08:08:10.998Z |
| last-modified | Thu, 15 Oct 2026 15:22:15 GMT |
| Size (bytes) | 2325200 |
| sha256 | 80e806c25e42f770da672eed88d2f9075a348d4a5571e24b1543f942c3a0e102 |
| Data rows | 15816 |

## Trimmed fixture

| Field | Value |
|---|---|
| File | companies-2026-10-21.xlsx |
| Rows matching a name | 60 |
| Random rows | 50 |
| Trimmed data rows | 110 |

Names (fixture brands, regulator-only cases, ground-truth brands present at capture time, test cases):
`Shell`, `TotalEnergies`, `Essity`, `Fairphone`, `Innocent Drinks`, `Mammut`, `Oatly AB`, `Signify`, `Oatly`, `Amazon`, `innocent drinks`, `JBS`, `Unilever`, `Asda`, `HelloFresh`, `Nike`, `Puma`, `Uniqlo`, `Shein`, `Primark`, `boohoo`, `H&M`, `ASOS`, `HP Inc.`, `Burger King`, `Lidl`, `Mango`, `Coca-Cola`, `Adidas`, `IKEA`, `Nestlé`, `Danone`, `PepsiCo`, `McDonald's`, `Schneider Electric`, `Iberdrola`, `Telia Company`, `Salesforce`, `Barry Callebaut`, `ASML`, `Cisco`, `Deutsche Telekom`, `Ericsson`, `Kingfisher`, `Legrand`, `Nokia`, `Novonesis`, `Siemens`, `Swisscom`, `Telenor`, `Hewlett Packard Enterprise`, `Novo Nordisk`, `Austrian Post`, `Activision Blizzard`, `Aviva`, `ALDI Nord Group`, `Inditex`, `H&M Group`, `Arla Foods`, `Patagonia`.
