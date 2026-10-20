/** The five claim-language rule families (PLAN Phase 3, brief Section 4). */
export type RuleFamily = "vague" | "absolute" | "offset" | "baseline-less comparison" | "future-only";

export type RuleId = "vague" | "absolute" | "offset" | "baseline_less_comparison" | "future_only";

/** [start, end) character offsets into the sentence. */
export type Span = [number, number];

export interface RuleMatch {
  ruleId: RuleId;
  /** The first matched phrase, verbatim. */
  phrase: string;
  /** Every matched trigger phrase. The claim's own wording is never counted as its own substantiation. */
  spans: Span[];
}

export interface RuleContext {
  /** The sentence that follows on the page, if any (offset and future-only rules look at it). */
  next?: string;
}

export interface ClaimRule {
  id: RuleId;
  family: RuleFamily;
  description: string;
  test(sentence: string, ctx?: RuleContext): RuleMatch | null;
}
