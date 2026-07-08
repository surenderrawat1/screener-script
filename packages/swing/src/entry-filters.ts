import type { SwingRule, SwingScanOptions } from './types.js';

/** Post-evaluateEntry rule gates (min count + required rule ids). */
export function matchesEntryRules(
  entry: { rules?: SwingRule[]; rules_passed?: number },
  options: Pick<SwingScanOptions, 'min_rules_passed' | 'require_rules'>,
): boolean {
  const rules = entry.rules ?? [];
  const required = options.require_rules ?? [];
  for (const id of required) {
    const rule = rules.find((r) => r.id === id);
    if (!rule || rule.passed !== true) return false;
  }
  const minPassed = options.min_rules_passed;
  if (minPassed != null && minPassed > 0 && Number(entry.rules_passed ?? 0) < minPassed) {
    return false;
  }
  return true;
}

export const ENTRY_RULE_IDS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11'] as const;
