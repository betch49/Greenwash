# Greenwash Radar — Brainstorm (Phase 0, step 1: builder draft)

Status: **draft for director critique** (brief Section 0.2 step 2). Nothing here is decided. Scores are the builder's honest estimates; the director is expected to challenge them.

Scale: user value, feasibility in v1, data availability: 1 (poor) to 5 (excellent). Legal risk: 1 (low) to 5 (high), lower is better.

"Data availability" is scored for the **shipped product** (a user's machine with normal internet). Where the **build container** differs, it is noted separately, because it decides what the tests can rely on (see Section 4).

---

## 1. What exists already

| Tool | What it does | Why it is not enough |
|---|---|---|
| **Good On You** | Rates fashion brands 1–5 on planet, people and animals using public reports and certifications. | Fashion only; the rating is shown, the line-by-line evidence behind it is not; no history of what a brand used to claim. |
| **Fashion Transparency Index** (Fashion Revolution) | Annual ranking of ~250 large fashion brands by how much they *disclose* (policies, supplier lists, impacts). | Measures disclosure, not whether claims are supported; fashion only; once a year; large brands only. |
| **B Corp directory** (B Lab) | Lists certified B Corps with their B Impact Assessment score. | Only covers companies that chose to certify; absence means nothing; no check of the claims a brand makes on its site. Bot-protected (see Section 4). |
| **CDP** | Disclosure platform for corporate climate, water and forest data, with A to D- scores. | Self-reported; detailed responses largely behind account/paywall; aimed at investors, not at checking consumer-facing claims. |
| **ChatGPT-style "ask AI"** | Instant fluent answer to "is brand X greenwashing?". | Opinion with no stable method, not reproducible, may cite sources it never read; no receipts, no confidence, no gaps shown. |

Our edge in one line: a deterministic score where every point traces to a fetched URL, a fetch date and a raw excerpt, plus historical and regulatory signals none of the five above surface.

---

## 2. Differentiators

### 2.1 Candidates from the brief (A–G)

#### A. Claim retraction detector (Wayback Machine)
| Criterion | Score | Evidence |
|---|---|---|
| User value | 5 | A claim quietly removed from a brand's own page is a concrete, dated, self-sourced signal; none of the tools in Section 1 show it. |
| Feasibility v1 | 3 | CDX query + text diff is simple, but pages move URL over 8 years, redesigns create diff noise, and JS-rendered pages archive as empty shells; needs the LLM "removed vs redesign" classifier with a rule cap. |
| Data availability | 3 | CDX API is public and free, but rate-limited (≤1 req/s) and often slow; **unreachable from the build container** (connection reset on every attempt), so tests rely entirely on hand-made fixtures. |
| Legal risk | 2 | Quoting a brand's own archived public page with dates is factual; risk rises only if we imply motive, so "correlate with regulator actions" must be shown side by side, never as cause. |

#### B. Goal-drift detector
| Criterion | Score | Evidence |
|---|---|---|
| User value | 4 | "Net zero by 2030" becoming "by 2040" is a strong, understandable signal. |
| Feasibility v1 | 2 | Needs A's whole snapshot pipeline plus reliable extraction and matching of dated targets across rewordings; matching "the same target" across years is fuzzy and would lean on the LLM. |
| Data availability | 2 | Same Wayback dependency as A; many targets live in PDF reports that are archived less consistently than HTML. |
| Legal risk | 2 | Factual comparison of the brand's own words; low if shown as two dated excerpts. |

#### C. Regulator rulings matcher
| Criterion | Score | Evidence |
|---|---|---|
| User value | 5 | An upheld ruling by an official body is the most authoritative receipt we can show. |
| Feasibility v1 | 3 | No APIs: HTML adapters. ASA `/search.html?q=` and JDP `/avis/` are server-rendered and parseable with cheerio; FTC listing is server-rendered but its fulltext filter appeared not to filter; entity matching is the hard part ("Shell Energy UK" vs "Shell UK Ltd" both appear for "shell"). |
| Data availability | 4 | ASA, JDP, ARPP, FTC, ACM, Reclame Code, AGCM all returned 200 from the container; no robots.txt blanket disallow on ASA/JDP/FTC/ACM. Coverage is limited to brands advertising in those countries. |
| Legal risk | 2 | Republishing public regulator decisions with links is low risk; the real risk is attaching a ruling to the wrong company, so matching must be conservative and show the ruled entity name verbatim. |

#### D. Certification registry check
| Criterion | Score | Evidence |
|---|---|---|
| User value | 4 | "Label claimed but not in the registry" is concrete and easy to understand. |
| Feasibility v1 | 2 | Every registry has a different format (search form, CSV, PDF list); label detection on brand pages plus name matching across registries is a lot of adapters for v1. |
| Data availability | 2 | bcorporation.net returns 403 with a Cloudflare challenge (`cf-mitigated: challenge`) even on the homepage; B Lab's data.world dataset needs an account (out of scope per Section 0.4); GOTS database redirects to a dynamic search; SBTi dashboard page returned 200 (CSV not yet verified). |
| Legal risk | 3 | A false "not found in registry" caused by a name mismatch (licensee under parent or supplier name) would be a damaging and wrong signal. |

#### E. Ownership & repair axis
| Criterion | Score | Evidence |
|---|---|---|
| User value | 4 | Unique in the greenwashing space and strong for electronics and durables; weak relevance for food and much apparel (where it would mostly show "not applicable"). |
| Feasibility v1 | 3 | iFixit API is JSON and works; warranty length, spare-parts and repair-program detection from brand pages is rule/heuristic work; "known anti-repair practices" has no structured source and must be dropped unless receipted. |
| Data availability | 3 | `ifixit.com/api/2.0/search/<q>` returned 200 JSON (19 results for "fairphone"); repairability scores exist only for devices iFixit has torn down; brand repair/warranty pages vary widely. |
| Legal risk | 2 | Low if limited to receipted facts (manual exists / parts page exists / warranty stated); anything resembling "blocks repair" without a receipt is excluded. |

#### F. Claim-language engine (deterministic) — ships regardless
| Criterion | Score | Evidence |
|---|---|---|
| User value | 3 | Useful baseline, but vague-term counting is what generic greenwashing checklists already do and is noisy on its own. |
| Feasibility v1 | 5 | Pure functions over fetched text: regex/lexicon rules, per-1,000-word normalisation, easy to unit test with 20 sentences. |
| Data availability | 5 | Needs only the brand's current pages (patagonia.com returned 200) or fixtures. |
| Legal risk | 2 | Flags language types, not intent; "vague term" is defensible wording. |

#### G. Intensity-vs-absolute emissions check
| Criterion | Score | Evidence |
|---|---|---|
| User value | 3 | A real and well-known trick, but niche and harder for a consumer to read. |
| Feasibility v1 | 2 | Requires finding the right PDF and extracting emissions tables; `pdf-parse` gives text, not tables, so extraction is fragile and report-specific. |
| Data availability | 2 | Only large brands publish multi-year emissions; CDP data is paywalled; many reports are PDFs behind JS download links. |
| Legal risk | 2 | Numbers come from the brand's own report; low if quoted with page reference. |

### 2.2 New ideas from the builder

#### H. Claim-to-proof check (substantiation proximity)
For each claim F flags, check deterministically whether the same page, or a page it links to, contains substantiation: a number with a unit and a year, a named standard or certifier, or a link to a report/methodology document. "Claim with no substantiation on the page or one link away" becomes the signal.
| Criterion | Score | Evidence |
|---|---|---|
| User value | 4 | Turns F's word counts into "this claim has no proof next to it", which is what regulators actually test (ASA/CMA guidance asks for substantiation). |
| Feasibility v1 | 4 | Rules over already-fetched HTML plus one hop of links; reuses F and the fetch/cache module. |
| Data availability | 4 | Same pages as F; one extra hop of fetches. |
| Legal risk | 1 | "No supporting data found on the page or linked pages" is a statement about what we fetched, with receipts. |

#### I. EU 2024/825 (ECGT) language flags
Map F rule hits to the categories restricted by Directive (EU) 2024/825 ("Empowering Consumers for the Green Transition"), which applies in EU member states from 27 September 2026: generic environmental claims without recognised excellent performance, sustainability labels not based on a certification scheme or public authority, and claims that a product has neutral/reduced impact based on offsetting. The separate Green Claims Directive proposal stalled in 2025 and should not be relied on.
| Criterion | Score | Evidence |
|---|---|---|
| User value | 4 | Gives F's flags an external, dated legal reference instead of our own taxonomy; topical now that the rules apply. |
| Feasibility v1 | 4 | A mapping table from F rule IDs to directive categories plus a citation; no new fetching. |
| Data availability | 4 | Directive text is public on EUR-Lex (not probed in this session; can be cited statically). |
| Legal risk | 3 | Must say "language of a type restricted under EU 2024/825", never "non-compliant": compliance is a legal conclusion, and the brand may not sell in the EU. |

#### J. Report freshness
Find the newest sustainability/impact report linked from the brand's pages and record its year; a missing or stale (more than 2 years) report lowers evidence confidence or adds an evidence-axis signal.
| Criterion | Score | Evidence |
|---|---|---|
| User value | 3 | Easy to understand, modest strength. |
| Feasibility v1 | 4 | Link discovery + year extraction from filename, link text or PDF metadata. |
| Data availability | 3 | Many brands link reports; some hide them behind JS or investor sites. |
| Legal risk | 1 | Purely "newest report we found is dated X", with URL. |

#### K. Parent-company roll-up
Use Wikidata P749 (parent organisation) from disambiguation to also run C (and D if chosen) on the parent, shown in a clearly separate "parent company" sub-list that does not feed the brand's own score unless the ruling names the brand.
| Criterion | Score | Evidence |
|---|---|---|
| User value | 4 | Many consumer brands are owned by groups whose rulings are under the group name. |
| Feasibility v1 | 4 | P749 is already fetched in Section 3 of the brief; it reruns the same adapters with a second name. |
| Data availability | 4 | Wikidata reachable (with retries, see Section 4); depends on C's sources. |
| Legal risk | 3 | Attributing a parent's ruling to a brand can mislead; mitigated by separate labelling and zero score weight by default. |

### 2.3 Summary table

| ID | Differentiator | Value | Feas. | Data | Legal (low=good) | Notes |
|---|---|---|---|---|---|---|
| A | Claim retraction (Wayback) | 5 | 3 | 3 (build: 1) | 2 | Highest value; build-env tests fixture-only |
| B | Goal drift | 4 | 2 | 2 | 2 | Depends on A; fuzzy matching |
| C | Regulator rulings | 5 | 3 | 4 | 2 | ASA + JDP parseable today |
| D | Certification registries | 4 | 2 | 2 | 3 | B Corp bot-blocked; account-gated data |
| E | Ownership & repair | 4 | 3 | 3 | 2 | Strong for electronics only |
| F | Claim language (baseline) | 3 | 5 | 5 | 2 | Ships regardless |
| G | Intensity vs absolute | 3 | 2 | 2 | 2 | PDF table extraction |
| H | Claim-to-proof (new) | 4 | 4 | 4 | 1 | Cheap extension of F |
| I | EU 2024/825 flags (new) | 4 | 4 | 4 | 3 | Mapping layer on F |
| J | Report freshness (new) | 3 | 4 | 3 | 1 | Small evidence-axis input |
| K | Parent roll-up (new) | 4 | 4 | 4 | 3 | Extension of C |

Builder observation (for the director, not a decision): the default A, C, E remains defensible on value. A's main weakness is that the build environment cannot reach Wayback, so its fixtures will be constructed rather than recorded. H and K are cheap extensions of F and C rather than standalone differentiators, and could ride along without counting as one of the three.

---

## 3. Stack note

**Next.js (App Router) + TypeScript only. No Python service in v1.**

- Every source probed is plain HTTP returning HTML or JSON (Wikidata, CDX, ASA, JDP, FTC, iFixit). `undici` + `cheerio` cover fetching and parsing; the `diff` npm package covers text diffs; `pdf-parse` covers report text if needed.
- A Python service would add a second runtime, a second test framework and a second process to start, against the "boring stack" rule, for no capability we need now.
- The one place Python would clearly win is PDF table extraction (pdfplumber/camelot) for G. Python 3.13 is present in the container, so if G is chosen the director can revisit; otherwise it is not justified.
- SQLite: `node:sqlite` works on Node 22.22 in this container (experimental warning); `better-sqlite3` prebuilt binaries are fetched from GitHub releases (download URL returned 302, i.e. reachable) and g++/make are present for a source build fallback. Drizzle + `better-sqlite3` is therefore viable as the brief specifies.
- JS-rendered brand pages: no headless rendering in the pipeline for v1 (Playwright is a test dependency only); such pages are reported as "skipped: page requires JavaScript".

---

## 4. Environment facts (measured 2026-10-20 ~21:40 UTC from the build container)

All requests went through the pre-configured HTTPS proxy with its CA bundle (TLS verification on), User-Agent `GreenwashRadar/0.1 (research prototype; contact: example@example.org)`.

| Target | Result | Implication |
|---|---|---|
| registry.npmjs.org | 200 (0.3 s) | `npm install` works. |
| www.wikidata.org `wbsearchentities` / `wbgetentities` | **Intermittent 429** ("too many requests", `Retry-After: ~53`) on the first calls even with a proper User-Agent; later calls 200, and a request with `curl --retry` honoring Retry-After succeeded. A no-UA request also got 200 once the window reset. | Shared egress IP is being rate-limited, not our UA. Adapter must send a descriptive UA, honor `Retry-After`, cache aggressively; tests use recorded fixtures. |
| query.wikidata.org SPARQL | 200 | Available as a fallback. |
| web.archive.org CDX (30 s timeout) | **Fails**: `Connection reset by peer` after 7–12 s, every attempt (3 tries, two different URLs); proxy status logs `tunnel closed (code 1006) ... host web.archive.org:443`. Also `web/<ts>id_/` raw snapshot fetch reset. | Wayback is unreachable from the build container. A and B can only be tested with hand-built fixtures; real-run check must happen on a user machine. Record in `docs/LIMITATIONS.md`. |
| archive.org `wayback/available` | 429 | Same conclusion. |
| www.patagonia.com | 200; robots.txt has no blanket disallow | Live brand fetch possible. |
| www.asa.org.uk | 200; `/search.html?q=shell` server-renders `/rulings/...` links; a ruling page returned 200; `codes-and-rulings/rulings.html?q=` results are not in server HTML | ASA adapter feasible via `/search.html`. |
| www.jdp-pub.org (France JDP) | 200; `/avis/` lists decisions server-side (`/avis/<brand>-<medium>/`) | JDP adapter feasible (French text). |
| www.arpp.org | 200 | Reachable. |
| www.ftc.gov cases-proceedings | 200; server-rendered case links, but `search_api_fulltext` did not visibly filter | FTC adapter needs a different query path; lower priority. |
| www.acm.nl/en | 200; `/en/search?...` returned 302 | Reachable; search path to be worked out. |
| www.reclamecode.nl | 200 | Reachable. |
| www.agcm.it | 200 (a guessed press-release URL 404) | Reachable; adapter path unknown. |
| www.bcorporation.net | **403** with Cloudflare challenge on every page, including homepage, although robots.txt allows `/` | B Corp directory not usable by a server-side fetcher; D's main registry is effectively unavailable. |
| www.ifixit.com and `/api/2.0/search/<q>` | 200, JSON API works | E has a structured data source. |
| sciencebasedtargets.org/target-dashboard | 200 | SBTi page reachable (CSV export not verified). |
| global-standard.org GOTS database | 301 | Not investigated further. |
| ANTHROPIC_API_KEY | **Absent** (`ANTHROPIC_BASE_URL` is set by the environment, key is not) | All LLM tests must use the mocked client; the real end-to-end check is "deferred: no API key". |
| Toolchain | Node 22.22.0, npm 10.9.4, Python 3.13, g++/make present | See Section 3. |
