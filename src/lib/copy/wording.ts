// All user-facing wording templates live here (ADR-008). Phase 3 extends this
// file with the signal templates and adds the forbidden-word test.

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
};

/** Entries for the report's "What we could not check" section. */
export const couldNotCheck = {
  noSustainabilityPage: (host: string) => `No sustainability, impact or responsibility page could be fetched from ${host}.`,
  robotsUnavailable: (origin: string) => `${origin} (its robots.txt could not be read, so we did not fetch from it).`,
  robotsDisallowed: (url: string) => `${url} (robots.txt does not allow us to fetch it).`,
};
