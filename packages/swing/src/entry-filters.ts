import type { SwingRule, SwingScanOptions } from './types.js';
import { HARD_ENTRY_RULE_IDS, summarizeHardSoftRules } from './entry-rule-tiers.js';

/** Max meaningful min_rules_passed under v3.11-lite (hard E1–E8 only). */
export const MAX_MIN_HARD_RULES = HARD_ENTRY_RULE_IDS.length;

/**
 * Post-evaluateEntry rule gates (min hard count + required rule ids).
 * `min_rules_passed` counts **hard** E1–E8 only — soft E9–E12 use `require_rules`.
 */
export function matchesEntryRules(
  entry: {
    rules?: SwingRule[];
    rules_passed?: number;
    rules_hard_passed?: number;
  },
  options: Pick<SwingScanOptions, 'min_rules_passed' | 'require_rules'>,
): boolean {
  const rules = entry.rules ?? [];
  const required = options.require_rules ?? [];
  for (const id of required) {
    const rule = rules.find((r) => r.id === id);
    if (!rule || rule.passed !== true) return false;
  }
  const minPassed = options.min_rules_passed;
  if (minPassed != null && minPassed > 0) {
    const hardPassed =
      entry.rules_hard_passed != null
        ? Number(entry.rules_hard_passed)
        : rules.length
          ? summarizeHardSoftRules(rules).hard_passed
          : Number(entry.rules_passed ?? 0);
    const floor = Math.min(minPassed, MAX_MIN_HARD_RULES);
    if (hardPassed < floor) return false;
  }
  return true;
}

export const ENTRY_RULE_IDS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'E12'] as const;
