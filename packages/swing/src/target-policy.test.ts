import { describe, expect, it } from 'vitest';
import {
  computeTradePlan,
  MAX_TARGET_PCT,
  MIN_TARGET_PCT,
  TARGET_RR_RATIO,
} from './evaluate-entry.js';
import { evaluateExit } from './evaluate-exit.js';
import { refreshPosition } from './position-tracker.js';

describe('frozen 3R target policy', () => {
  it('exports the institutional target band', () => {
    expect(TARGET_RR_RATIO).toBe(3);
    expect(MIN_TARGET_PCT).toBe(7);
    expect(MAX_TARGET_PCT).toBe(25);
  });

  it('keeps 3R targets inside the 7–25% band', () => {
    // Min effective risk is 2.75% → 3R ≈ 8.25% (above the 7% floor).
    const tight = computeTradePlan(100, 99, 99, 0.5);
    expect(tight.target_pct).toBeGreaterThanOrEqual(MIN_TARGET_PCT);
    expect(tight.target_pct).toBeLessThanOrEqual(MAX_TARGET_PCT);
    expect(tight.target_frozen).toBe(true);

    // Hard stop is capped at 5% → 3R = 15%, still under the 25% absolute ceiling.
    const wide = computeTradePlan(100, 50, 50, null);
    expect(wide.risk_pct).toBeCloseTo(5, 1);
    expect(wide.target_pct).toBe(15);
    expect(wide.profit_target).toBe(115);
    expect(wide.target_pct).toBeLessThanOrEqual(MAX_TARGET_PCT);
    expect(wide.r_multiple_ok).toBe(true);
  });
  it('keeps the stored entry target frozen on live refresh', () => {
    const frozen = 120;
    const refreshed = refreshPosition(
      {
        id: '1',
        symbol: 'TEST',
        entry_price: 100,
        entry_date: '2026-07-01',
        shares: 10,
        stop_loss: 95,
        profit_target: frozen,
      },
      {
        ta: {
          ta_ready: true,
          ta_price: 110,
          ta_sma50: 98,
          ta_ema21: 102,
          ta_rsi14: 55,
          ta_macd_hist: 0.2,
          as_of_date: '2026-07-10',
        },
        price: 110,
        bars: [
          { time: '2026-07-01', open: 100, high: 101, low: 99, close: 100, volume: 1e6 },
          { time: '2026-07-10', open: 109, high: 111, low: 108, close: 110, volume: 1e6 },
        ],
      },
    );
    expect(refreshed.profit_target).toBe(frozen);
    expect(refreshed.exit.profit_target).toBe(frozen);
  });

  it('evaluateExit X2 uses the frozen entry target, not a recomputed plan', () => {
    const exit = evaluateExit(
      {
        ta_ready: true,
        ta_price: 118,
        ta_sma50: 100,
        ta_ema21: 105,
        ta_rsi14: 60,
        ta_macd_hist: 0.4,
        as_of_date: '2026-07-20',
      },
      118,
      100,
      '2026-07-01',
      null,
      118,
      null,
      null,
      112, // frozen entry target
      12,
    );
    expect(exit.profit_target).toBe(112);
    expect(exit.target_pct).toBe(12);
    expect(exit.triggered).toContain('X2');
  });
});
