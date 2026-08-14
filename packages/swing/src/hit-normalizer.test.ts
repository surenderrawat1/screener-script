import { describe, expect, it } from 'vitest';
import { normalizeScanHit } from './hit-normalizer.js';
import { evaluateEntry } from './evaluate-entry.js';

describe('hit-normalizer hard/soft fields', () => {
  it('flattens rules_hard_* from evaluateEntry', () => {
    const ta = {
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
      ta_as_of_date: '2026-06-01',
    };
    const entry = evaluateEntry(ta, 102);
    const hit = normalizeScanHit('TCS', 102, ta, entry as unknown as Record<string, unknown>);
    expect(hit.rules_hard_total).toBe(8);
    expect(hit.rules_soft_total).toBe(4);
    expect(Number(hit.rules_hard_passed)).toBeGreaterThanOrEqual(6);
    expect(hit.engine_version).toBe('v3.18-real-fill-edge');
  });
});
