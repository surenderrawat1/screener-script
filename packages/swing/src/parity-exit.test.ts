import { describe, expect, it } from 'vitest';
import {
  computeActiveStop,
  computeTrailStop,
  evaluateExit,
  exitRuleDefinitions,
  TRAIL_FROM_HIGH_BEAR_PCT,
} from './evaluate-exit.js';
import { evaluateEntry, ENGINE_VERSION } from './evaluate-entry.js';

const bullTa = {
  ta_sma9: 101.5,
  ta_sma50: 100.0,
  ta_sma200: 95.0,
  ta_ema9: 103.0,
  ta_ema21: 101.0,
  ta_ema50: 99.0,
  ta_ema200: 94.0,
  ta_rsi14: 48.0,
  ta_pct_52w: 55.0,
  ta_bb_pct_b: 60.0,
  ta_macd_hist: 0.5,
  ta_avg_value_cr: 25.0,
  ta_volume_ratio: 1.35,
  ta_bull_ma_stack: true,
  ta_bar_count: 220,
  ta_ready: true,
};

describe('swing exit parity', () => {
  it('has nine exit rule definitions', () => {
    expect(exitRuleDefinitions()).toHaveLength(9);
    expect(ENGINE_VERSION).toBe('v3.9-gc9');
  });

  it('breakeven arms at 50% of target', () => {
    const be = computeActiveStop(100, 95, 3, 5, 98.5, 99);
    expect(be.breakeven_armed).toBe(true);
    expect(be.active_stop).toBeGreaterThanOrEqual(100.35);
  });

  it('trail arms after sufficient gain', () => {
    const trailBull = computeTrailStop(100, 5, 110, 10, 104, { bull: true });
    expect(trailBull.trail_armed).toBe(true);
    expect(trailBull.trail_stop ?? 0).toBeGreaterThanOrEqual(110 * (1 - 2.5 / 100) - 0.02);
  });

  it('bear regime uses tighter trail %', () => {
    const trailBear = computeTrailStop(100, 5, 110, 10, null, { bear: true });
    expect(trailBear.trail_from_high_pct).toBe(TRAIL_FROM_HIGH_BEAR_PCT);
  });

  it('ratchet floor never lowers trail', () => {
    const ratchet = computeTrailStop(100, 5, 108, 10, null, null, 105.5);
    expect(ratchet.trail_stop ?? 0).toBeGreaterThanOrEqual(105.5);
  });

  it('price at +12% triggers profit exit X2', () => {
    const exit = evaluateExit(bullTa, 112, 100, '2024-01-01');
    expect(exit.verdict).toBe('EXIT');
    expect(exit.triggered).toContain('X2');
  });

  it('small gain below target is HOLD', () => {
    const hold = evaluateExit(bullTa, 101, 100, new Date().toISOString().slice(0, 10));
    expect(hold.verdict).toBe('HOLD');
  });

  it('exit eval trail armed on winner', () => {
    const exitTrail = evaluateExit(
      { ...bullTa, as_of_date: '2024-06-01' },
      107,
      100,
      '2024-01-01',
      null,
      112,
      null,
      null,
      null,
      null,
      null,
      null,
      105,
    );
    expect(exitTrail.trail_armed).toBe(true);
    expect(exitTrail.active_stop ?? 0).toBeGreaterThanOrEqual((exitTrail.trail_stop ?? 0) - 0.02);
  });

  it('bullish TA still scores ENTER', () => {
    const entry = evaluateEntry(bullTa, 102);
    expect(entry.verdict).toBe('ENTER');
  });
});
