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
    expect(ENGINE_VERSION).toBe('v3.18-real-fill-edge');
  });

  it('breakeven arms after peak +1% (cost-to-cost)', () => {
    const be = computeActiveStop(100, 95, 1.0, 8.25, null, null, 1.0);
    expect(be.breakeven_armed).toBe(true);
    expect(be.breakeven_arm_pct).toBe(1);
    expect(be.active_stop).toBeGreaterThanOrEqual(100.35);
  });

  it('before +1% peak, hard stop still applies (no CTC yet)', () => {
    const raw = computeActiveStop(100, 95, 0.5, 8.25, null, null, 0.8);
    expect(raw.breakeven_armed).toBe(false);
    expect(raw.active_stop).toBe(95);
  });

  it('profit-lock floors at +1.5% after peak +3%', () => {
    const lock = computeActiveStop(100, 95, 1.0, 8.25, null, null, 3.2);
    expect(lock.breakeven_armed).toBe(true);
    expect(lock.profit_lock_armed).toBe(true);
    expect(lock.active_stop).toBeGreaterThanOrEqual(101.5);
  });

  it('breakeven stays armed after pullback when peak MFE earned it', () => {
    // Current gain 0% but peak was +1.2% — must keep cost-to-cost floor.
    const be = computeActiveStop(100, 95, 0, 8.25, null, null, 1.2);
    expect(be.breakeven_armed).toBe(true);
    expect(be.active_stop).toBeGreaterThanOrEqual(100.35);
  });

  it('trail arms by max(+2.5%, 40% of target)', () => {
    // 8.25% target → arm at 3.3%; peak +2.5% alone is not enough.
    const early = computeTrailStop(100, 0.5, 102.5, 8.25, null, { bull: true });
    expect(early.trail_armed).toBe(false);
    const armed = computeTrailStop(100, 1, 103.3, 8.25, null, { bull: true });
    expect(armed.trail_armed).toBe(true);
    expect(armed.trail_arm_pct).toBe(3.3);
    expect(armed.trail_stop ?? 0).toBeGreaterThanOrEqual(100.35);
  });

  it('trail floors at profit-lock after peak +3% when trail is armed', () => {
    const trail = computeTrailStop(100, 2, 104, 8.25, null, { bull: true });
    expect(trail.trail_armed).toBe(true);
    expect(trail.trail_stop ?? 0).toBeGreaterThanOrEqual(101.5);
  });

  it('trail arms after sufficient gain', () => {
    // Peak +5% with 10% target — below 75% runner threshold → default 2.5% trail.
    const trailBull = computeTrailStop(100, 5, 105, 10, 104, { bull: true });
    expect(trailBull.trail_armed).toBe(true);
    expect(trailBull.trail_from_high_pct).toBe(2.5);
    expect(trailBull.trail_stop ?? 0).toBeGreaterThanOrEqual(105 * (1 - 2.5 / 100) - 0.02);
  });

  it('trail arms from peak MFE even when current gain pulled back', () => {
    // HAL-style: ran to +5.15% then closed near flat — trail must remain armed.
    const trail = computeTrailStop(100, -0.5, 105.15, 8.25, null, { bull: true });
    expect(trail.trail_armed).toBe(true);
    expect(trail.trail_stop ?? 0).toBeGreaterThan(100);
  });

  it('bear regime uses tighter trail % before runner mode', () => {
    const trailBear = computeTrailStop(100, 5, 105, 10, null, { bear: true });
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

  it('pullback after peak triggers X6 trail, not a disarmed hold', () => {
    const exit = evaluateExit(
      { ...bullTa, as_of_date: '2024-06-20' },
      101.0, // pulled back near entry
      100,
      '2024-06-01',
      null,
      105.15, // prior MFE +5.15%
      null,
      null,
      108.25, // frozen ~8.25% target
      8.25,
      { bull: true },
    );
    expect(exit.trail_armed).toBe(true);
    expect(exit.triggered).toContain('X6');
    expect(exit.verdict).toBe('EXIT');
  });

  it('scratches dead trade after 5 sessions clearly red with no +1% peak', () => {
    const bars = [
      { time: '2024-01-02', open: 100, high: 100.2, low: 99.5, close: 100, volume: 1 },
      { time: '2024-01-03', open: 100, high: 100.4, low: 99.2, close: 99.5, volume: 1 },
      { time: '2024-01-04', open: 99.5, high: 99.8, low: 99.0, close: 99.3, volume: 1 },
      { time: '2024-01-05', open: 99.3, high: 99.6, low: 98.8, close: 99.1, volume: 1 },
      { time: '2024-01-08', open: 99.1, high: 99.4, low: 98.5, close: 99.0, volume: 1 },
      { time: '2024-01-09', open: 99.0, high: 99.2, low: 98.4, close: 98.8, volume: 1 },
    ];
    const exit = evaluateExit(
      { ...bullTa, as_of_date: '2024-01-09' },
      98.8,
      100,
      '2024-01-02',
      null,
      100.4,
      bars,
      bars,
      108.25,
      8.25,
      { bull: true },
    );
    expect(exit.triggered).toContain('X7');
    expect(exit.verdict).toBe('EXIT');
  });

  it('bullish TA still scores ENTER', () => {
    const entry = evaluateEntry(bullTa, 102);
    expect(entry.verdict).toBe('ENTER');
  });
});
