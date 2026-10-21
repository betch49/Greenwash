// Claim-language lexicon (PLAN Phase 3). Data only: every phrase the rule
// engine looks for lives here as a regular-expression source string, so that a
// wording change is a data change. The rules in ./rules/*.ts compile these
// lists; docs/METHODOLOGY.md describes them in words.
//
// Conventions: patterns are matched case-insensitively unless listed under a
// `caseSensitive` key, and are wrapped in word boundaries by the compiler
// (`(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])`), so "green" never matches "evergreen".

/** Vague environmental wording (rule `vague`). */
export const VAGUE = {
  phrases: [
    "eco[- ]?friendly",
    "environmentally friendly",
    "environment[- ]friendly",
    "earth[- ]friendly",
    "planet[- ]friendly",
    "nature[- ]friendly",
    "climate[- ]friendly",
    "eco[- ]conscious",
    "environmentally conscious",
    "conscious (?:choice|choices|consumption|collection|exploration|brand|company|fashion|living|materials?|design)",
    "responsibly (?:made|sourced|produced|crafted|manufactured)",
    "green (?:company|brand|business|products?|choice|option|materials?|gear|packaging|alternative)",
    "(?:all[- ])?natural (?:products?|materials?|ingredients?|fibres?|fibers?|packaging)",
    "(?:safe|good) and natural",
    "clean (?:products?|materials?|ingredients?|production|beauty|fashion|gear)",
    "low[- ]impact",
    "kind to (?:the )?(?:planet|earth|environment|nature)",
  ],
  /** "sustainable" used as a bare adjective. Qualified uses belong to other families or are proper names. */
  bareSustainable: "sustainable",
  /** Words directly before "sustainable" that move the phrase to another family (comparison, absolute). */
  bareSustainableNotAfter: ["more", "most", "less", "fully", "completely", "totally", "entirely", "100%", "100 %", "truly"],
  /** Proper names and fixed terms in which "sustainable" is not a claim about the brand. */
  bareSustainableNotIn: [
    "sustainable development goals?",
    "world business council for sustainable development",
    "sustainable development",
    "sustainable apparel coalition",
    "roundtable on sustainable palm oil",
    "sustainable finance",
  ],
} as const;

/** Absolute claims (rule `absolute`). */
export const ABSOLUTE = {
  phrases: [
    "zero (?:environmental |climate |carbon )?impact",
    "no (?:environmental |climate )?impact (?:on|at all)",
    "impact[- ]free",
    "100 ?% (?:sustainable|natural|green|eco[- ]?friendly|clean|environmentally friendly|planet[- ]friendly|guilt[- ]free)",
    "100 percent (?:sustainable|natural|green|eco[- ]?friendly|clean)",
    "(?:fully|completely|totally|entirely|truly) (?:sustainable|natural|green|eco[- ]?friendly|harmless|circular|clean)",
    "(?:the )?most sustainable",
    "harmless to (?:the )?(?:planet|environment|nature)",
  ],
  /** "zero waste" counts only when bare, i.e. not qualified by "to landfill" or similar. */
  zeroWaste: "zero[- ]waste",
  zeroWasteQualifiers: ["to landfill", "to incineration", "sent to", "certified", "certification", "by 20"],
} as const;

/** Offset-based neutrality claims in the present tense (rule `offset`). */
export const OFFSET = {
  phrases: [
    "(?:carbon|climate|co2|co₂|ghg|emissions?|e-waste|plastic)[- ]neutral(?:ity)?",
    "net[- ]zero",
    "zero[- ]net",
    "(?:carbon|climate)[- ](?:positive|negative)",
    "carbon[- ]free",
    "fully offset",
    "(?:100 ?%|completely) offset",
    "climate[- ]compensated",
  ],
  /** A sentence with one of these cues talks about the future, which is the `future_only` family's job. */
  futureCues: [
    "will",
    "we'll",
    "we’ll",
    "shall",
    "by (?:19|20)\\d\\d",
    "aim(?:s|ing)? to",
    "aspire(?:s)? to",
    "goal",
    "target(?:s|ed|ing)?",
    "ambition",
    "commit(?:s|ted|ment)?(?: to)?",
    "pledge(?:s|d)?",
    "plan(?:s|ned)? to",
    "path to",
    "going to",
    "journey to(?:wards)?",
    "on (?:our|the) way to",
    "working towards?",
    "strive(?:s)? to",
    "roadmap",
    "reach(?:es|ing)?",
    "achiev(?:e|es|ing)",
    "become",
  ],
  /** Proper names in which "net zero" is not a claim about the brand. */
  notIn: ["oxford net zero", "net zero banking alliance", "net zero asset managers", "net zero tracker", "un race to zero"],
  /** A reduction figure is a number + unit in a sentence that also has one of these verbs. */
  reductionVerbs: [
    "reduc(?:e|ed|es|ing|tion|tions)",
    "cut(?:s|ting)?",
    "lower(?:ed|ing)?",
    "decreas(?:e|ed|es|ing)",
    "fell",
    "fallen",
    "dropped",
    "down",
    "avoid(?:ed|s)?",
    "less",
  ],
} as const;

/** Comparisons without a baseline (rule `baseline_less_comparison`). */
export const COMPARISON = {
  phrases: [
    "more (?:sustainable|eco[- ]?friendly|environmentally friendly|responsible|circular|planet[- ]friendly|natural)",
    "greener (?:choices?|options?|alternatives?|products?|future|way|planet|world|materials?|production|gear|packaging)",
    "(?:is|are|be|becomes?) (?:greener|cleaner)",
    "cleaner (?:and (?:greener|smarter)|production|processes|manufacturing|materials?|energy|choices?|options?|alternatives?|future|planet)",
    "less (?:plastic|water|waste|energy|packaging|carbon|co2|co₂|impact|emissions)",
    "less (?:climate|environmental|carbon) (?:impact|footprint)",
    "lower (?:impact|footprint|emissions)",
    "lower (?:climate|carbon|environmental|co2|co₂) (?:impact|footprint|emissions)",
    "(?:smaller|reduced) (?:carbon |climate |environmental )?(?:footprint|impact)",
    "better for (?:the )?(?:planet|environment|earth|climate|nature)",
    "kinder to (?:the )?(?:planet|environment|earth|nature)",
  ],
  /** Any of these in the sentence supplies a baseline, so the sentence is not a hit. */
  baselineCues: ["than", "compared (?:with|to)", "versus", "vs\\.?", "relative to", "baseline"],
} as const;

/** Future-only commitments (rule `future_only`). */
export const FUTURE = {
  phrases: [
    "we (?:will|shall)",
    "we'll",
    "we’ll",
    "(?:our|the) (?:company|business|brand|group|products?|packaging|operations|supply chain|factories|stores|sites|collection) will",
    "will (?:be|become|reach|achieve|go|turn) (?:fully |100 ?% )?(?:carbon|climate|co2|co₂|net|plastic|e-waste|renewable|circular|recycl\\w*)",
    "aim(?:s|ing)? to",
    "aspire(?:s)? to",
    "committed to",
    "commit(?:s)? to",
    "pledge(?:s|d)? to",
    "our (?:goal|target|ambition) is",
    "(?:goal|target|ambition) (?:is|of) to",
    "we plan to",
    "(?:we are|we're|we’re) planning to",
    "strive(?:s)? to",
    "working towards?",
    "on (?:our|the) (?:way|path|journey) to",
  ],
  /**
   * "by 20XX" is a trigger too, but when it is the only one the sentence must
   * also name who commits (ADR-015): "By 2050, an estimated 120 million tons of
   * e-waste will be generated" is a statistic, not a commitment.
   */
  byYear: "by (?:19|20)\\d\\d",
  /** Commitment subjects; the run's brand name is added at scan time. */
  commitmentSubjects: ["we", "we're", "we’re", "we've", "we’ve", "our", "ours", "us", "the company", "the brand", "the group"],
  /** Legal suffixes stripped from the brand name before it is used as a subject cue. */
  brandSuffixes: ["inc", "ltd", "llc", "ag", "ab", "sa", "gmbh", "bv", "plc", "corp", "corporation", "co", "group", "s\\.a", "b\\.v"],
  /** The sentence must be about an environmental topic, otherwise "will" is ordinary grammar. */
  topics: [
    "emissions?",
    "carbon",
    "co2",
    "co₂",
    "ghg",
    "greenhouse",
    "climate",
    "net[- ]zero",
    "neutral",
    "renewable",
    "recycl\\w*",
    "packaging",
    "waste",
    "water",
    "plastic",
    "regenerative",
    "sustainab\\w*",
    "biodiversity",
    "deforestation",
    "footprint",
    "energy",
    "circular\\w*",
    "environment\\w*",
    "planet\\w*",
    "nature",
    "scope [123]",
    "fossil",
    "pfas",
    "chemicals?",
  ],
  /** A progress figure: a number + unit in a sentence that also has one of these past-progress cues. */
  progressCues: [
    "since",
    "so far",
    "to date",
    "already",
    "have",
    "has",
    "had",
    "achieved",
    "reached",
    "cut",
    "reduced",
    "fell",
    "fallen",
    "decreased",
    "dropped",
    "was",
    "were",
    "last year",
    "in (?:19|20)\\d\\d",
  ],
} as const;

/**
 * Named standards and certifiers (substantiation marker, and the evidence rule
 * `labels_claimed`). `label: false` entries substantiate a sentence but are not
 * product or company labels, so they are not listed as "label claimed".
 */
export const CERTIFIERS: readonly { name: string; pattern: string; caseSensitive?: boolean; label: boolean }[] = [
  { name: "GOTS", pattern: "GOTS|Global Organic Textile Standard", caseSensitive: true, label: true },
  { name: "Fair Trade", pattern: "Fair Trade(?: Certified| USA)?", label: true },
  { name: "Fairtrade", pattern: "Fairtrade", label: true },
  { name: "B Corp", pattern: "B[- ]Corp(?:oration)?s?|Certified B Corporation", caseSensitive: true, label: true },
  { name: "FSC", pattern: "FSC", caseSensitive: true, label: true },
  { name: "bluesign", pattern: "bluesign", label: true },
  { name: "OEKO-TEX", pattern: "OEKO[- ]TEX", label: true },
  { name: "SBTi", pattern: "SBTi|Science Based Targets(?: initiative)?", label: false },
  { name: "ISO 14001", pattern: "ISO ?14001", label: true },
  { name: "Cradle to Cradle", pattern: "Cradle to Cradle|C2C Certified", label: true },
  { name: "EU Ecolabel", pattern: "EU Ecolabel", label: true },
  { name: "Rainforest Alliance", pattern: "Rainforest Alliance", label: true },
  { name: "RWS", pattern: "RWS|Responsible Wool Standard", caseSensitive: true, label: true },
  { name: "RDS", pattern: "RDS|Responsible Down Standard", caseSensitive: true, label: true },
  { name: "GRS", pattern: "GRS|Global Recycled Standard", caseSensitive: true, label: true },
  { name: "RCS", pattern: "RCS|Recycled Claim Standard", caseSensitive: true, label: true },
  { name: "Climate Neutral Certified", pattern: "Climate Neutral Certified", label: true },
  { name: "1% for the Planet", pattern: "1 ?% for the Planet|One Percent for the Planet", label: true },
  { name: "Fair Wear", pattern: "Fair Wear(?: Foundation)?", label: true },
  { name: "TCO Certified", pattern: "TCO Certified", label: true },
  { name: "iFixit", pattern: "iFixit", label: false },
];

/** Substantiation markers (PLAN Phase 3 deliverable 2). */
export const SUBSTANTIATION = {
  /** Number + unit. The number may use thousands separators and decimals. */
  numberUnit:
    "\\d+(?:[.,]\\d+)*\\s?(?:%|percent|per cent|tco2e?|t co2e?|tco₂e?|t co₂e?|tonnes?|tons?|t|kt|mt|kg|kgco2e|kwh|mwh|gwh|twh|litres?|liters?|m3|m³)",
  /** A calendar year. Recorded only next to a number + unit in the same sentence (ADR-014). */
  year: "(?:19[5-9]\\d|20\\d\\d)",
  /** A year after one of these is a target date, never a marker (ADR-014). */
  targetPrepositions: ["by", "until", "till", "before", "no later than", "towards", "toward", "ahead of"],
  /** Link text that points at evidence. */
  anchorText: "report|data|methodology|footnote|study|assessment",
  /** Window: the matched sentence and this many following sentences. */
  followingSentences: 2,
} as const;

/** Evidence-axis page rules (PLAN Phase 3 deliverable 4). */
export const EVIDENCE = {
  /** Anchor text or href that names a report. */
  reportLink: "report|impact|sustainability",
  /** Number followed by an absolute emissions unit. */
  absoluteEmissions:
    "\\d+(?:[.,]\\d+)*\\s?(?:k|thousand |million )?(?:tco2e?|tco₂e?|t co2e?|t co₂e?|(?:metric )?(?:tonnes?|tons?)(?: of)? co2e?|(?:metric )?(?:tonnes?|tons?)(?: of)? co₂e?)",
  /** A sentence with these words reports avoided or offset emissions, not the brand's own footprint. */
  notAbsoluteEmissions: "avoid\\w*|saved|sav(?:e|es|ing)|offset\\w*|compensat\\w*|per (?:liter|litre|unit|product|kg|device|phone)",
  supplierList: "supplier list|factory list|list of (?:our )?(?:suppliers|factories)|our factories|supply chain map|supplier map|factory map",
  /** A report whose newest year is more than this many years before the page's fetch year is stale. */
  staleAfterYears: 2,
} as const;

/** Sentence splitting: abbreviations after which a full stop does not end a sentence. */
export const ABBREVIATIONS = [
  "e.g", "i.e", "etc", "inc", "ltd", "co", "corp", "no", "nr", "st", "dr", "mr", "mrs", "ms", "vs", "approx", "ca",
  "fig", "u.s", "u.k", "e.u", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
] as const;

/** Signal excerpts are cut to this many characters. */
export const EXCERPT_MAX_CHARS = 300;
