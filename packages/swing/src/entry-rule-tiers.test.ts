import { describe, expect, it } from 'vitest';
import {
  ENTRY_RULE_META,
  HARD_ENTRY_RULE_IDS,
  SOFT_ENTRY_RULE_IDS,
  entryRuleTier,
  summarizeHardSoftRules,
} from './entry-rule-tiers.js';
import { buildSwingEngineMeta } from './swing-engine-meta.js';
import { evaluateEntry, ENGINE_VERSION } from './evaluate-entry.js';

describe('entry-rule-tiers v3.11-lite', () => {
  it('classifies E1–E8 hard and E9–E12 soft', () => {
    expect(HARD_ENTRY_RULE_IDS).toEqual(['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']);
    expect(SOFT_ENTRY_RULE_IDS).toEqual(['E9', 'E10', 'E11', 'E12']);
    expect(ENTRY_RULE_META).toHaveLength(12);
    expect(entryRuleTier('E1')).toBe('hard');
    expect(entryRuleTier('E12')).toBe('soft');
  });

  it('summarizes hard/soft from evaluateEntry', () => {
    const entry = evaluateEntry(
      {
        ta_sma9: 101.5,
        ta_sma20: 101,
        ta_sma50: 100,
        ta_sma200: 95,
        ta_ema9: 103,
        ta_ema21: 101,
        ta_ema50: 99,
        ta_ema200: 94,
        ta_rsi14: 48,
        ta_pct_52w: 55,
        ta_bb_pct_b: 60,
        ta_macd_hist: 0.5,
        ta_avg_value_cr: 25,
        ta_bar_count: 220,
        ta_ready: true,
      },
      102,
    );
    expect(entry.rules_hard_total).toBe(8);
    expect(entry.rules_soft_total).toBe(4);
    expect(entry.rules_hard_passed).toBeGreaterThanOrEqual(6);
    const s = summarizeHardSoftRules(entry.rules);
    expect(s.hard_passed).toBe(entry.rules_hard_passed);
  });

  it('exposes tiers on engine meta', () => {
    const meta = buildSwingEngineMeta();
    expect(meta.engine_version).toBe(ENGINE_VERSION);
    expect(meta.hard_entry_rule_count).toBe(8);
    expect(meta.soft_entry_rule_count).toBe(4);
    expect(meta.rule_stack_note).toMatch(/v3\.18/);
  });
});
