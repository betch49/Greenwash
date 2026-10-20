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
  analysePlaceholder: "The analysis pipeline arrives in the next build phase. Nothing has been fetched yet.",
};
