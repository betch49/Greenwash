# Source fixtures (Phase 5)

Real recorded responses of the regulator and repair sources, served offline by
`src/lib/fetch/source-fixtures.ts` (`manifest.json`: URL ⇒ file and capture time, served as `fetched_at`).
Recorded with `npm run record:sources` (`scripts/record-sources.ts`): the pipeline's own adapters, robots.txt
checked before every request, 1 request per second per host, `GreenwashRadar/0.1 …` User-Agent, normal TLS
verification through the container's proxy CA. Inline `<script>` bodies are removed from HTML; each HTML file starts
with `<!-- real capture: <url> on <date> … -->`. Nothing here is hand-written (ADR-011; guard test
`tests/unit/regulators/fixtures.test.ts`). A URL that is not recorded is served as 404, which is what iFixit answered
for "Mammut".

| Directory | What | Why |
|---|---|---|
| `regulators/oatly/` | ASA search "Oatly" + the ruling *Oatly UK Ltd t/a Oatly* (26 January 2022, upheld in part); JDP search "Oatly" (no decision) | food fixture brand; the real ruling for criterion 5.4 |
| `regulators/mammut/`, `regulators/fairphone/` | ASA and JDP searches, no result | the other two fixture brands |
| `regulators/shell/` | ASA search "Shell" + three ruling pages (*Shell UK Ltd t/a Shell*, *Shell UK Ltd*, *Shell Energy UK*) | regulator-only case: exact-name and partial-name rulings (the `possible` path, PLAN's `asa-ambiguous` fixture) |
| `regulators/totalenergies/` | JDP search "TotalEnergies" + three decision pages (fondée après révision, rejetée, fondées) | regulator-only case: none of the fixture brands has a JDP decision; needed for criterion 5.2 |
| `repair/fairphone/` | iFixit device categories *Fairphone*, *Fairphone 5*, *Fairphone 6*, *Fairphone 6plus* (JSON) | electronics fixture brand, criterion 5.6 |
| `regulators/innocent/`, `regulators/signify/`, `regulators/essity/` | ASA and JDP searches, no result | Phase 10 validation brands (`record:sources -- --add …`) |
| `regulators/totalenergies/asa*.html` | ASA search "TotalEnergies" + the ruling *TotalEnergies SE* (shown as a possible match) | Phase 10: the TotalEnergies brand fixture; its JDP pages were already recorded and were kept as they were |
| `robots/` | robots.txt of www.asa.org.uk, www.jdp-pub.org, www.ifixit.com | the offline run checks them like the live one |

Oatly is the food brand, so no iFixit lookup is made for it (repair axis not applicable).

Phase 10 added the four validation brands with `npm run record:sources -- --add innocent totalenergies signify essity`.
In `--add` mode nothing is deleted and a URL that is already in the manifest is served from its file instead of being
fetched again, so every earlier capture is unchanged. iFixit answered 404 for TotalEnergies, Signify and Essity (no device
category); innocent is a food brand (no iFixit lookup).
