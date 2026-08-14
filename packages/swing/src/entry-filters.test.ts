import { describe, expect, it } from 'vitest';
import { matchesEntryRules, MAX_MIN_HARD_RULES } from './entry-filters.js';

describe('matchesEntryRules', () => {
  const rules = [
    { id: 'E1', name: 'Trend', criterion: '', passed: true, detail: '' },
    { id: 'E2', name: 'Pullback', criterion: '', passed: false, detail: '' },
    { id: 'E3', name: 'MACD', criterion: '', passed: true, detail: '' },
    { id: 'E4', name: '52w', criterion: '', passed: true, detail: '' },
    { id: 'E5', name: 'Ext', criterion: '', passed: true, detail: '' },
    { id: 'E6', name: 'Liq', criterion: '', passed: true, detail: '' },
    { id: 'E7', name: 'EMA', criterion: '', passed: true, detail: '' },
    { id: 'E8', name: 'PA', criterion: '', passed: null, detail: '' },
    { id: 'E11', name: 'GC9', criterion: '', passed: true, detail: '' },
    { id: 'E12', name: 'Stratzy', criterion: '', passed: true, detail: '' },
  ];

  it('passes when no extra filters', () => {
    expect(matchesEntryRules({ rules, rules_passed: 8 }, {})).toBe(true);
  });

  it('min_rules_passed counts hard E1–E8 only (soft E11/E12 ignored)', () => {
    // hard true: E1,E3,E4,E5,E6,E7 = 6 (E2 fail, E8 null)
    expect(matchesEntryRules({ rules, rules_passed: 8 }, { min_rules_passed: 7 })).toBe(false);
    expect(matchesEntryRules({ rules, rules_passed: 8 }, { min_rules_passed: 6 })).toBe(true);
    expect(matchesEntryRules({ rules, rules_hard_passed: 7 }, { min_rules_passed: 7 })).toBe(true);
  });

  it('caps min floor at MAX_MIN_HARD_RULES', () => {
    expect(MAX_MIN_HARD_RULES).toBe(8);
    expect(matchesEntryRules({ rules, rules_hard_passed: 8 }, { min_rules_passed: 12 })).toBe(true);
    expect(matchesEntryRules({ rules, rules_hard_passed: 7 }, { min_rules_passed: 12 })).toBe(false);
  });

  it('enforces require_rules including soft ids', () => {
    expect(matchesEntryRules({ rules, rules_passed: 2 }, { require_rules: ['E1', 'E11'] })).toBe(true);
    expect(matchesEntryRules({ rules, rules_passed: 2 }, { require_rules: ['E2'] })).toBe(false);
  });
});
