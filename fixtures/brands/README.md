# Brand fixtures

The three fixture brands (PLAN conventions: one outdoor apparel, one electronics, one food) are **real captures**.
A fourth, **fictional** fixture (`northwind`) is hand-built for rule and edge-case tests only (ADR-011).
Offline mode (`GR_OFFLINE_FIXTURES=1`) and the unit tests serve these files through
`FixtureFetcher`. `src/lib/fetch/brand-fixtures.ts` reads each brand's `manifest.json`.
A URL that is not in a manifest is served as 404, which is also what the live sites returned
for the heuristic paths they do not have.

| Slug | Sector | Wikidata | Website | Capture | Pages |
|---|---|---|---|---|---|
| `mammut` | outdoor apparel | Q495318 Mammut (query `mammut sports group`) | https://www.mammut.com/us/en/ | **real**, 2026-10-20T22:56Z | 12 |
| `fairphone` | electronics | Q5019402 Fairphone | https://www.fairphone.com/ | **real**, 2026-10-20T22:36Z | 14 (12 kept, 2 dropped as duplicates) |
| `oatly` | food | Q10605824 Oatly AB | https://www.oatly.com/ | **real**, 2026-10-20T22:36Z | 10 (9 kept; the home page has too little server-rendered text) |
| `northwind` | fictional, test-only | none | https://www.northwind-outdoor.example | **synthetic**, hand-built 2026-10-20 | 7 (+ 4 Wayback snapshots) |
| `quillmoor` | fictional, test-only (food) | none | https://www.quillmoor-foods.example | **synthetic**, hand-built 2026-10-20 | 2 (+ 3 Wayback snapshots) |

## Layout of each brand directory

- `meta.json`: slug, Wikidata query, sector, website, `capture` (`real` or `synthetic`), capture date, and the
  Wikidata entity exactly as the recorded Wikidata fixtures resolve it (`fixtures/wikidata/`).
- `manifest.json`: `{ capturedAt, files: { "<url>": "<file>" } }`. `capturedAt` is served as `fetched_at`, so
  offline receipts carry the capture date and not the time of the test.
- `robots/<host>.txt`, `sitemaps/<host>-<path>.xml`, `pages/<host>-<path>.html`.
- Wayback history (Phase 4, optional): `manifest.json` `wayback: { "<page url>": "<page-slug>" }`; the CDX query for that page
  is served from `cdx/<page-slug>.json` (header row + one row per capture, exactly the CDX `output=json` format) and the
  `id_` snapshot with timestamp `YYYYMMDDhhmmss` from `snapshots/<page-slug>/<YYYYMMDD>.html`. Hand-built histories exist
  only for the fictional brands (ADR-011); a real brand's history may only be a recorded CDX/`id_` response, and none
  could be recorded because web.archive.org resets connections from the build container (`docs/LIMITATIONS.md`).

## Real captures (Mammut, Fairphone, Oatly)

Recorded with `npm run record:brand -- <slug> <query> <sector>` (`scripts/record-brand.ts`). The script runs the
pipeline's own discovery and page fetch steps against the live site: descriptive User-Agent
(`GreenwashRadar/0.1 …`), robots.txt checked before every page, 1 request per second per host, normal TLS
verification through the container's proxy CA (`NODE_EXTRA_CA_CERTS`). It saves every 2xx response that the
pipeline requested, so offline replay follows the same path as the live run.

Two changes are made at capture time; both leave the visible text unchanged:

1. Inline `<script>` bodies are removed from HTML (scripts with `src`, and JSON-LD, are kept). Scripts are never
   part of the visible text, and without this change the Oatly pages alone would be about 8 MB.
2. Sitemaps over 1 MB are rewritten with the same `<loc>` list and nothing else. Oatly's 9.7 MB sitemap
   (5,180 URLs plus hreflang alternates) becomes 465 KB. The file starts with a comment saying so.

Each HTML file starts with a `<!-- real capture: <url> on <date> … -->` comment.

## Why not Patagonia

`www.patagonia.com` and `eu.patagonia.com` answered every request from the build container, including
`/robots.txt`, with a bot-protection page ("Hang Tight! Routing to checkout..."). We did not try to get around it,
and we do not imitate it (ADR-011): a hand-written page under a real brand's URL would become a "receipt" for text
the brand never published. Mammut replaced it as the outdoor-apparel brand. The Phase 1 Wikidata fixtures for
"patagonia" stay; offline, a Patagonia run ends with `skipped: no page could be fetched from patagonia.com`.

Mammut notes: plain "mammut" finds the extinct genus first on Wikidata (no company offered, URL fallback), so the
recorded query is "mammut sports group". Its Wikidata entity lists `http://www.mammut.ch` and
`https://www.mammut.com/us/en/` (both normal rank); the https one is used (`src/lib/wikidata/entities.ts`). The
site's sitemaps use `/<country>/<language>/` prefixes; these collapse as translations, and the website's own
locale (`us/en`) wins.

## Synthetic, fictional fixture (Northwind Outdoor)

A fictional brand on a reserved `.example` domain (RFC 2606), with no Wikidata entity. Every file starts with a
`synthetic fixture … FICTIONAL brand` comment; no real company published this text. It is used only by the
rule and edge-case tests (2.2, 2.3, 2.4; later Phases 3 and 5), never as one of the three brands. You reach it in
the app by pasting `https://www.northwind-outdoor.example` in the URL fallback. A unit test
(`tests/unit/fetch/brand-fixtures.test.ts`) enforces ADR-011: a `synthetic` fixture has a reserved TLD and no
Wikidata id, and every HTML file of a `real` fixture starts with `<!-- real capture:`.

- `robots.txt` declares `sitemap_index.xml` and disallows `/stories/archive/`. The pages sitemap lists
  `/stories/archive/our-footprint-2019/`, so a run shows `skipped: robots.txt disallows …` (criterion 2.4).
- `sitemap_index.xml` nests two sitemaps. The products sitemap is listed first and visited last (2.2).
- The pages sitemap also lists `/fr/our-footprint/` (collapsed as a translation) and a PDF (not fetched as a page).
- Each page has a `NAV SENTINEL 7F3A` string in `<nav>` and a `FOOTER SENTINEL 9B2C` string in `<footer>`,
  and neither may appear in the visible text (2.3).
- The text holds a mix of substantiated and unsubstantiated claim sentences, a report link, a supplier
  list link, labels, repair and warranty pages, for Phases 3 and 5.

## Wayback snapshot fixtures (fictional brands only)

- **Northwind, `/our-footprint/`**: CDX rows for 2020-06-11, 2021-03-15, 2024-09-02 and 2025-04-10. The 2020 and 2021
  copies contain "Every Northwind jacket is climate neutral, so you can wear it with a clear conscience."; the 2024 and
  2025 copies do not. The rest of the page is largely unchanged (figures updated each year, a nav item and the promo
  bar changed). Expected: exactly one `claim.removed` (2021 → 2024), test 4.4 and e2e 4.7. The other Northwind pages
  the step looks up (the robots-disallowed archive page, supply chain, climate goals) have empty CDX answers (`[]`).
- **Quillmoor Foods, `/sustainability`**: CDX rows for 2020-08-07, 2022-05-19 (table layout) and 2025-01-28 (redesign:
  cards and headings, the carbon-neutral sentence becomes a heading, "We're committed" becomes "We are committed",
  paragraphs reordered). Expected: zero `claim.removed`, test 4.5. The live `/sustainability` page matches the 2025 design.

## Nav sentinels used by tests/unit/discover/visible-text.test.ts

| Brand | Page | Sentinel (only in site chrome) |
|---|---|---|
| mammut | `pages/www-mammut-com-us-en-responsibility.html` | `Loyalty Program` (real menu item) |
| fairphone | `pages/www-fairphone-com-impact-report.html` | `Shop smartphone accessories` (real menu item) |
| oatly | `pages/oatly-com-sustainability.html` | `For Investors` (real menu item) |
| northwind (fictional) | `pages/www-northwind-outdoor-example-our-footprint.html` | `NAV SENTINEL 7F3A` (synthetic) |
