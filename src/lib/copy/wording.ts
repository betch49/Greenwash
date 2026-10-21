// All user-facing wording templates live here (ADR-008). Allowed vocabulary:
// "risk signal", "unsupported claim", "no supporting data found on the fetched
// page", "label claimed on page; not verified in v1", "not found",
// "skipped: <reason>". tests/unit/copy/forbidden.test.ts scans every string
// literal under src/ against src/lib/copy/forbidden.ts.

/** What the Wayback Machine gave us for a robots-disallowed page (mirrors ArchiveOutcome in src/lib/pipeline/types.ts). */
export type ArchiveNote =
  | { kind: "read"; count: number; from: number; to: number }
  | { kind: "none"; from: number; to: number }
  | { kind: "no_answer"; status: number }
  | { kind: "unreachable"; reason: string }
  | { kind: "not_looked_up"; maxPages: number };

export const skippedReason = (reason: string) => `skipped: ${reason}`;

export const ui = {
  appName: "Greenwash Radar",
  tagline: "Evidence-backed greenwashing risk signals. Signals, not verdicts.",
  searchLabel: "Brand name",
  searchButton: "Search",
  confirmHeading: (q: string) => `Which “${q}” did you mean?`,
  didYouMean: "Did you mean",
  confirm: "Confirm",
  notThisOne: "Not this one",
  notFoundHeading: (q: string) => `We could not find a company called “${q}”.`,
  allRejectedHeading: "None of these? Paste the brand’s website instead.",
  urlLabel: "Brand website URL",
  urlButton: "Continue with this website",
  urlInvalid: "Please enter a valid website address, for example https://example.com.",
  lookupFailed: (reason: string) => `Brand lookup unavailable (${reason}). You can paste the brand’s website instead.`,
  analyseHeading: (brand: string) => `Analysing ${brand}`,
  analyseStart: "Start analysis",
  analyseNotStarted: "The analysis has not started yet.",
  analyseRunning: "Analysis in progress…",
  analyseDone: "Analysis finished.",
  openReport: "Open the full report",
  analyseFailed: "The analysis stopped because of an error. Steps that ran are listed below.",
  progressHeading: "Progress",
  pagesHeading: (n: number) => `Pages fetched (${n})`,
  pagesNone: "No pages could be fetched from this website.",
  fetchedOn: (iso: string) => `fetched ${iso.slice(0, 10)}`,
  words: (n: number) => `${n} words`,
  statusDone: "done",
  statusRunning: "running…",
  timelineHeading: "Timeline of archived claims",
  timelineIntro: "Claim sentences found in archived copies of the brand’s pages (Wayback Machine), one copy per year.",
  timelineNone: "No archived copies were compared.",
  timelineSnapshot: (year: number, date: string) => `${year} (archived ${date})`,
  timelineClaimsPresent: (n: number) => `${n} claim sentence${n === 1 ? "" : "s"} present`,
  timelineRemoved: (from: number, to: number) => `claim removed between ${from} and ${to}`,
  /** ADR-017: the live page is the last element of a page's history. */
  timelineRemovedLive: (from: number) => `claim removed between ${from} and the current page`,
  timelineLive: (date: string) => `current page (fetched ${date})`,
  timelineLiveCopy: "current page",
  summaryHeading: "Summary",
  summaryUnavailable: "Summary unavailable",
  summaryAiNote: "Written by an AI model from the receipts below; it may cite only pages this report fetched.",
  timelineArchivedCopy: "archived copy",
  couldNotCheckHeading: "What we could not check",
};

/** Pipeline step names shown in the progress list. */
export const steps = {
  pipeline: "Pipeline",
  discover: "Discovering pages",
  fetchPages: "Fetching current pages",
  fetchPage: (url: string) => `Fetching ${url}`,
  claims: "Checking claim language",
  evidence: "Checking published evidence",
  wayback: (from: number, to: number) => `Pulling ${from}–${to} snapshots`,
  fetchSnapshot: (url: string) => `Fetching snapshot ${url}`,
  asa: "Checking ASA (UK) rulings",
  jdp: "Checking JDP (France) decisions",
  repair: "Checking repair information",
  fetchRuling: (url: string) => `Fetching ruling ${url}`,
  ifixit: "Looking up iFixit",
  llmExtract: "Proposing candidate claims (AI)",
  llmClassify: "Classifying archived changes (AI)",
  llmSummary: "Writing the plain-English summary (AI)",
};

/** Reasons recorded when a step or a page is skipped (shown as "skipped: <reason>"). */
export const reasons = {
  invalidWebsite: (website: string) => `the website address is not usable (${website})`,
  noCandidates: "no candidate pages were found",
  noPages: (host: string) => `no page could be fetched from ${host}`,
  httpStatus: (status: number, url: string) => `HTTP ${status} for ${url}`,
  fetchFailed: (url: string, message: string) => `could not fetch ${url} (${message})`,
  tooLittleText: (url: string, words: number) => `too little visible text at ${url} (${words} words)`,
  notHtml: (url: string, type: string) => `not an HTML page: ${url} (${type})`,
  robotsUnavailable: (origin: string, cause: string) => `robots.txt unavailable for ${origin} (${cause})`,
  interrupted: "analysis interrupted (server restarted); search again to retry",
  stepError: (message: string) => `internal error (${message})`,
  noPagesToScan: "no fetched page to scan",
  waybackUnreachable: (cause: string) => `Wayback unreachable (${cause})`,
  noPagesForWayback: "no sustainability-type page to look up in the Wayback Machine",
  regulatorUnreachable: (name: string, cause: string) => `${name} unreachable (${cause})`,
  regulatorParse: (name: string, what: string) => `${name} ${what} could not be parsed`,
  repairNotApplicable: (industry: string) => `not applicable: the brand’s industry on Wikidata is “${industry}”, whose products are consumed, not repaired`,
  ifixitUnreachable: (cause: string) => `iFixit unreachable (${cause})`,
  ifixitNotListed: (name: string) => `iFixit lists no device category named “${name}”`,
  noApiKey: "no API key",
  noLlmClient: "no LLM client configured",
  llmUnavailable: (why: string) => `LLM unavailable (${why})`,
  llmInvalid: (what: string, why: string) => `${what}: AI output rejected (${why})`,
  llmFailed: (what: string, why: string) => `${what}: AI call failed (${why})`,
  llmNoAnswer: (what: string) => `${what}: no AI answer`,
  llmNoPages: "no fetched page to read",
  llmNoCandidates: "no removed claim to classify",
};

/** Every possible-match line starts with this (ADR-019); the report page lists those lines apart, as not scored. */
export const POSSIBLE_MATCH_PREFIX = "Possible match, not scored:";

/** Entries for the report's "What we could not check" section. */
export const couldNotCheck = {
  noSustainabilityPage: (host: string) => `No sustainability, impact or responsibility page could be fetched from ${host}.`,
  robotsUnavailable: (origin: string) => `${origin} (its robots.txt could not be read, so we did not fetch from it).`,
  /** Brief Section 8: a page robots.txt keeps us from fetching is read from the Wayback Machine, and we say so. */
  robotsDisallowed: (url: string, archive?: ArchiveNote) => {
    const base = `${url} (robots.txt does not allow us to fetch it`;
    if (!archive) return `${base}).`;
    switch (archive.kind) {
      case "read":
        return `${base}; we read ${archive.count} archived ${archive.count === 1 ? "copy" : "copies"} from the Wayback Machine instead (${archive.from === archive.to ? archive.from : `${archive.from}–${archive.to}`}), used for the timeline only, not scored as current wording).`;
      case "none":
        return `${base}; the Wayback Machine has no archived copy from ${archive.from}–${archive.to}, so nothing on it was checked).`;
      case "no_answer":
        return `${base}; the Wayback Machine answered HTTP ${archive.status}, so its archived copies could not be read).`;
      case "unreachable":
        return `${base}; its archived copies could not be read: ${archive.reason}).`;
      case "not_looked_up":
        return `${base}; not looked up in the Wayback Machine: only sustainability-type pages, at most ${archive.maxPages} per brand).`;
    }
  },
  labelClaimed: (name: string, url: string) => `${name}: label claimed on page; not verified in v1 (${url}).`,
  waybackUnreachable: (reason: string) => `Archived versions of the brand’s pages: ${reason}.`,
  waybackNoHistory: (url: string, status: number) => `Archived versions of ${url} (the Wayback Machine answered HTTP ${status}).`,
  waybackNoSnapshots: (url: string, from: number, to: number) => `${url}: no archived snapshot from ${from}–${to} in the Wayback Machine.`,
  waybackOneSnapshot: (url: string, year: number) => `${url}: only one archived snapshot (${year}), so no change over time could be checked.`,
  /** ADR-003: every report says which regulators were searched. */
  regulatorCoverage: "Regulator rulings: only the UK ASA and the French JDP were searched; rulings by other countries’ regulators were not checked.",
  regulatorSkipped: (name: string, reason: string) => `${name} rulings: not checked (${reason}).`,
  regulatorRulingSkipped: (url: string, reason: string) => `${url}: ruling page not read (${reason}).`,
  /** A ruling naming an entity whose name only contains the brand: shown, never scored (ADR-003). */
  regulatorPossible: (name: string, entity: string, url: string) =>
    `${POSSIBLE_MATCH_PREFIX} ${name} ruling naming “${entity}” (${url}); the ruled entity’s name is not the brand’s name, so we do not attribute it.`,
  repairNotApplicable: (industry: string) =>
    `Repair and ownership: not applicable (Wikidata industry “${industry}”: products are consumed, not repaired); this axis is not scored.`,
  repairNoPages: "Repair information on the brand’s own pages: no page could be fetched, so none was checked.",
  ifixitSkipped: (reason: string) => `iFixit repair guides: not checked (${reason}).`,
  llmSkipped: (why: string) =>
    `AI-assisted steps (candidate claims, archived-change classification, summary): not run (${why}); the score uses the rule-based signals only.`,
};

/** How each claim-language rule family is named in signal labels (rule ids: src/lib/claims/rules). */
export const claimFamilyNames = {
  vague: "vague environmental wording",
  absolute: "absolute claim",
  offset: "neutrality claim without a reduction figure",
  baseline_less_comparison: "comparison without a baseline",
  future_only: "future commitment without a progress figure",
} as const;

/** Signal labels (one line each, shown next to the receipt). */
export const signalLabels = {
  claimUnsupported: (family: string) => `Unsupported claim (${family}): no supporting data found on the fetched page`,
  claimSupported: (family: string) => `Risk signal (${family}); a figure with a unit, a named standard or a report link appears next to it on the page`,
  reportFound: (year: number) => `Impact or sustainability report linked (${year})`,
  reportFoundUndated: "Impact or sustainability report linked (no year given)",
  staleReport: (year: number, fetchYear: number, years: number) =>
    `Risk signal: the newest report linked is from ${year}, more than ${years} years before the page was fetched (${fetchYear})`,
  noReport: "Risk signal: no impact or sustainability report link found on the fetched pages",
  absoluteEmissions: "Absolute emissions figure (tonnes of CO2e) published on the page",
  supplierList: "Supplier or factory list linked",
  /** ADR-008: "ruling found naming <entity verbatim>". The outcome words are the regulator's own. */
  rulingFound: (entity: string, regulator: string, country: string, date: string, outcome: string) =>
    `Ruling found naming ${entity} (${regulator}, ${country}, ${date}); outcome as published: ${outcome}`,
  repairManual: "Repair guide or service manual offered on the brand’s site",
  spareParts: "Spare or replacement parts offered on the brand’s site",
  warranty: (years: number | "lifetime") => (years === "lifetime" ? "Lifetime warranty stated on the brand’s site" : `${years}-year warranty stated on the brand’s site`),
  repairProgram: "Repair service or programme offered on the brand’s site",
  noRepairInfo: "Risk signal: no repair guide, spare parts, warranty length or repair service found on the fetched pages",
  ifixitDevices: (n: number, brand: string) => `iFixit lists ${n} device ${n === 1 ? "category" : "categories"} with repair information for ${brand}`,
  ifixitGuides: (device: string, n: number) => `iFixit has ${n} repair ${n === 1 ? "guide" : "guides"} for ${device}`,
  ifixitScore: (device: string, score: number) => `iFixit repairability score for ${device}: ${score}/10`,
  claimRemoved: (from: number, to: number) =>
    `Claim removed between ${from} and ${to}: present in the ${from} archived copy of the page, absent from the ${to} copy`,
  /** ADR-017: newest archived copy vs the page as fetched now. */
  claimRemovedLive: (from: number, fetched: string) =>
    `Claim removed between ${from} and the current page: present in the ${from} archived copy, absent from the page as fetched on ${fetched}`,
};

/** Excerpts that the engine writes itself (the receipt still points at the page). */
export const excerpts = {
  link: (text: string, href: string) => (text ? `“${text}” (${href})` : href),
  pagesScanned: (titles: string[]) => `Pages scanned: ${titles.join("; ")}`,
  pagesScannedWithUrls: (pages: { title: string; url: string }[]) => `Pages scanned: ${pages.map((p) => (p.title ? `${p.title} (${p.url})` : p.url)).join("; ")}`,
};

/** Score lines (PLAN Phase 6; brief Section 4). */
export const scoreWording = {
  label: { low: "Low signals", moderate: "Moderate signals", high: "High signals" } as const,
  scoreLine: (score: number, confidence: number) => `Score ${score}, confidence ${confidence}%`,
  basis: (signals: number, sources: number) => `Based on ${signals} verified signal${signals === 1 ? "" : "s"} from ${sources} source${sources === 1 ? "" : "s"}.`,
  aiShare: (pct: number) => `AI contributed to ${pct}% of this score`,
  scoreHeading: "Greenwashing risk signals score",
  axisNames: { claims: "Claim language", evidence: "Evidence & certifications", track: "Track record", repair: "Ownership & repair" } as const,
  axisStatus: { scored: "scored", missing: "no data (lowers confidence)", not_applicable: "not applicable (weight shared out)" } as const,
  methodologyLink: "How the score is computed",
};

/** The report page /report/[id] (PLAN Phase 8; brief Section 3.4). */
export const reportWording = {
  title: (brand: string) => `${brand}: greenwashing risk signals`,
  heading: (brand: string) => `${brand}: greenwashing risk signals`,
  generated: (date: string) => `Report generated ${date}`,
  website: "Website",
  wikidata: "Wikidata",
  logoAlt: (brand: string) => `${brand} logo (Wikimedia Commons)`,
  scoreOutOf: "out of 100",
  headlineHeading: "Score",
  axesHeading: "The four axes",
  axisSubscore: (n: number) => `Sub-score ${n}/100`,
  axisWeight: (configured: number, effective: number) =>
    configured === effective ? `weight ${configured}%` : `weight ${configured}% (${effective}% after redistribution)`,
  receiptsCount: (n: number) => `${n} receipt${n === 1 ? "" : "s"}`,
  noReceipts: "No signal on this axis.",
  source: "Source",
  fetched: (date: string) => `fetched ${date}`,
  archived: (date: string) => `archived copy of ${date}`,
  entity: (name: string) => `entity named: ${name}`,
  points: (n: number) => `${n} risk point${n === 1 ? "" : "s"}`,
  protectivePoints: "0 points (protective: listed, counts as data)",
  aiAssisted: "AI-assisted",
  aiAssistedTitle: "An AI step proposed or classified this signal; the rule engine and the receipt decide it.",
  possibleHeading: "Possible matches (not scored)",
  possibleIntro: "Regulator rulings naming an entity whose name contains the brand’s name but is not the brand’s name. They are listed for you to check and are not part of any axis.",
  skippedHeading: "Skipped steps",
  skippedNone: "No step was skipped.",
  llmCallsHeading: "AI calls in this report",
  llmCallsNone: "No AI call was made.",
  llmCall: (name: string, fixture: boolean, status: string) => `${name}: ${status}${fixture ? " (recorded answer)" : ""}`,
  llmCallsNote: "AI answers never set a number in the score; at most half of the score may depend on AI-assisted signals.",
  shareHeading: "Share and export",
  shareLabel: "Link to this report",
  download: "Download evidence (JSON)",
  rerun: "Re-run the analysis",
  rerunNote: (date: string) => `This report was generated ${date} and is served from the stored copy. Re-running fetches every source again.`,
  newSearch: "Search for another brand",
  notFound: "Report not found",
};

/** The /methodology page (numbers come from config/weights.json, the rest from docs/METHODOLOGY.md). */
export const methodologyPage = {
  title: "Methodology",
  intro: "How Greenwash Radar turns receipted signals into a score. Every number on this page is read from the weights file the scorer uses.",
  weightsHeading: "Axis weights",
  axisColumn: "Axis",
  weightColumn: "Weight",
  capColumn: "Cap",
  pointsHeading: "Points per signal kind",
  kindColumn: "Signal kind",
  pointsColumn: "Points",
  protective: "0 (protective: listed, counts as data)",
  rulesHeading: "Other parameters",
  documentHeading: "Full methodology",
};
