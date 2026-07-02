import { describe, expect, it } from 'vitest';
import { fromTa, BIAS_SHORT } from './gc9-dc9.js';
import { evaluateEntry } from './evaluate-entry.js';
import { matchesGc9Entry } from './scanner.js';

describe('swing parity — validate-logic.php', () => {
  const gc9Ta = {
    ta_sma9: 105.0,
    ta_sma50: 100.0,
    ta_sma200: 95.0,
    ta_ema9: 106.0,
    ta_ema21: 103.0,
    ta_ema50: 99.0,
    ta_ema200: 94.0,
    ta_rsi14: 58.0,
    ta_pct_52w: 55.0,
    ta_bb_pct_b: 70.0,
    ta_macd_hist: 0.6,
    ta_avg_value_cr: 25.0,
    ta_volume_ratio: 1.2,
    ta_golden_cross_9_50: true,
    ta_cross_9_50_time: '2024-06-01',
    ta_bar_count: 220,
    ta_ready: true,
  };

  it('GC9 fixture marks gc9_entry', () => {
    const entry = evaluateEntry(gc9Ta, 106.0);
    expect(entry.gc9?.gc9_entry).toBe(true);
    expect(entry.rules[10]?.passed).toBe(true);
  });

  it('DC9 fixture is short bias', () => {
    const dc9Ta = { ...gc9Ta, ta_golden_cross_9_50: false, ta_death_cross_9_50: true, ta_sma9: 98.0 };
    const state = fromTa(dc9Ta, 99.0);
    expect(state.bias).toBe(BIAS_SHORT);
  });

  it('matchesGc9Entry filter', () => {
    const entry = evaluateEntry(gc9Ta, 106.0);
    expect(matchesGc9Entry(entry, gc9Ta, 106.0, true)).toBe(true);
    const dc9Ta = { ...gc9Ta, ta_golden_cross_9_50: false, ta_death_cross_9_50: true, ta_sma9: 98.0 };
    const dc9Entry = evaluateEntry(dc9Ta, 99.0);
    expect(matchesGc9Entry(dc9Entry, dc9Ta, 99.0, false)).toBe(true);
  });
});
