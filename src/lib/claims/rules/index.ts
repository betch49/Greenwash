import { absoluteRule } from "./absolute";
import { comparisonRule } from "./comparison";
import { futureRule } from "./future";
import { offsetRule } from "./offset";
import type { ClaimRule, RuleId } from "./types";
import { vagueRule } from "./vague";

export type { ClaimRule, RuleContext, RuleFamily, RuleId, RuleMatch, Span } from "./types";

/** The rule registry: one rule per family, in report order. docs/METHODOLOGY.md lists every id (test 3.7). */
export const CLAIM_RULES: readonly ClaimRule[] = [vagueRule, absoluteRule, offsetRule, comparisonRule, futureRule];

export const RULE_IDS: readonly RuleId[] = CLAIM_RULES.map((r) => r.id);

export function ruleById(id: RuleId): ClaimRule {
  const rule = CLAIM_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`unknown claim rule ${id}`);
  return rule;
}
