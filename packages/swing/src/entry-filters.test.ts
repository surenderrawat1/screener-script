import { describe, expect, it } from 'vitest';
import { matchesEntryRules } from './entry-filters.js';

describe('matchesEntryRules', () => {
  const rules = [
    { id: 'E1', name: 'Trend', criterion: '', passed: true, detail: '' },
    { id: 'E2', name: 'Pullback', criterion: '', passed: false, detail: '' },
    { id: 'E11', name: 'GC9', criterion: '', passed: true, detail: '' },
  ];

  it('passes when no extra filters', () => {
    expect(matchesEntryRules({ rules, rules_passed: 8 }, {})).toBe(true);
  });

  it('enforces min_rules_passed', () => {
    expect(matchesEntryRules({ rules, rules_passed: 2 }, { min_rules_passed: 8 })).toBe(false);
    expect(matchesEntryRules({ rules, rules_passed: 8 }, { min_rules_passed: 8 })).toBe(true);
  });

  it('enforces require_rules', () => {
    expect(matchesEntryRules({ rules, rules_passed: 2 }, { require_rules: ['E1', 'E11'] })).toBe(true);
    expect(matchesEntryRules({ rules, rules_passed: 2 }, { require_rules: ['E2'] })).toBe(false);
  });
});
