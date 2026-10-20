// All user-facing wording templates live here (ADR-008). Allowed vocabulary:
// "risk signal", "unsupported claim", "no supporting data found on the fetched
// page", "label claimed on page; not verified in v1", "not found",
// "skipped: <reason>". tests/unit/copy/forbidden.test.ts scans every string
// literal under src/ against src/lib/copy/forbidden.ts.

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
  analyseDone: "Page collection finished. Scoring arrives in a later build phase.",
  analyseFailed: "The analysis stopped because of an error. Steps that ran are listed below.",
  progressHeading: "Progress",
  pagesHeading: (n: number) => `Pages fetched (${n})`,
  pagesNone: "No pages could be fetched from this website.",
  fetchedOn: (iso: string) => `fetched ${iso.slice(0, 10)}`,
  words: (n: number) => `${n} words`,
  statusDone: "done",
  statusRunning: "running…",
};

/** Pipeline step names shown in the progress list. */
export const steps = {
  pipeline: "Pipeline",
  discover: "Discovering pages",
  fetchPages: "Fetching current pages",
  fetchPage: (url: string) => `Fetching ${url}`,
  claims: "Checking claim language",
  evidence: "Checking published evidence",
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
};

/** Entries for the report's "What we could not check" section. */
export const couldNotCheck = {
  noSustainabilityPage: (host: string) => `No sustainability, impact or responsibility page could be fetched from ${host}.`,
  robotsUnavailable: (origin: string) => `${origin} (its robots.txt could not be read, so we did not fetch from it).`,
  robotsDisallowed: (url: string) => `${url} (robots.txt does not allow us to fetch it).`,
  labelClaimed: (name: string, url: string) => `${name}: label claimed on page; not verified in v1 (${url}).`,
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
  claimSupported: (family: string) => `Risk signal (${family}); a figure, year, standard or report link appears next to it on the page`,
  reportFound: (year: number) => `Impact or sustainability report linked (${year})`,
  reportFoundUndated: "Impact or sustainability report linked (no year given)",
  staleReport: (year: number, fetchYear: number, years: number) =>
    `Risk signal: the newest report linked is from ${year}, more than ${years} years before the page was fetched (${fetchYear})`,
  noReport: "Risk signal: no impact or sustainability report link found on the fetched pages",
  absoluteEmissions: "Absolute emissions figure (tonnes of CO2e) published on the page",
  supplierList: "Supplier or factory list linked",
};

/** Excerpts that the engine writes itself (the receipt still points at the page). */
export const excerpts = {
  link: (text: string, href: string) => (text ? `“${text}” (${href})` : href),
  pagesScanned: (titles: string[]) => `Pages scanned: ${titles.join("; ")}`,
};
