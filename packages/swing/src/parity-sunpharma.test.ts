import { describe, expect, it } from 'vitest';
import { MOMENTUM_STRONG } from './dynamic-signals.js';
import { computeTradePlan, evaluateEntry } from './evaluate-entry.js';
import { entry52wBand } from './market-regime.js';

/** PHP golden: SUNPHARMA @ 1904.80 EOD 2026-07-03 (bear regime). */
const SUNPHARMA_PRICE = 1904.8;
const SUNPHARMA_SMA50 = 1832.09;
const SUNPHARMA_EMA21 = 1849.19;
const SUNPHARMA_ATR_PCT = 2.8;

const sunpharmaDynamic = {
  momentum: MOMENTUM_STRONG,
  volume_surge: true,
  golden_cross_active: true,
  gc9_active: true,
  entry_ok: true,
  dynamic_stop: 1890.1,
};

describe('parity — SUNPHARMA trade plan', () => {
  it('computeTradePlan matches PHP effective stop, boosted target, and R', () => {
    const plan = computeTradePlan(
      SUNPHARMA_PRICE,
      SUNPHARMA_SMA50,
      SUNPHARMA_EMA21,
      SUNPHARMA_ATR_PCT,
      sunpharmaDynamic,
    );
    expect(plan.effective_stop).toBeCloseTo(1852.42, 2);
    expect(plan.profit_target).toBeCloseTo(2080.8, 2);
    expect(plan.target_pct).toBeCloseTo(9.24, 2);
    expect(plan.r_multiple).toBeCloseTo(3.36, 2);
    expect(plan.r_multiple_ok).toBe(true);
  });

  it('evaluateEntry applies momentum boost on bear-regime fixture', () => {
    const bearRegime = { bear: true, label: 'Bear', key: 'bear' };
    const ta = {
      ta_price: SUNPHARMA_PRICE,
      ta_sma9: 1871.92,
      ta_sma50: SUNPHARMA_SMA50,
      ta_sma200: 1744.59,
      ta_ema9: 1880,
      ta_ema21: SUNPHARMA_EMA21,
      ta_ema50: 1822.57,
      ta_ema200: 1740,
      ta_rsi14: 70.2,
      ta_pct_52w: 94.6,
      ta_bb_pct_b: 95.8,
      ta_macd_hist: 5.101,
      ta_avg_value_cr: 365.3,
      ta_volume_ratio: 1.15,
      ta_atr_pct: SUNPHARMA_ATR_PCT,
      ta_golden_cross_9_50: true,
      ta_cross_9_50_time: '2026-05-05',
      ta_52w_chart_zone: 'red',
      ta_bar_count: 252,
      ta_ready: true,
      ta_ema_bull_stack: true,
      ta_ema_bear_stack: false,
    };

    const bars = Array.from({ length: 252 }, (_, i) => ({
      time: `2025-${String((i % 12) + 1).padStart(2, '0')}-15`,
      open: 1700 + i,
      high: 1720 + i,
      low: 1680 + i,
      close: 1700 + i * 0.5,
      volume: 1_000_000,
    }));
    bars[bars.length - 1] = {
      time: '2026-07-03',
      open: 1900,
      high: 1910,
      low: 1895,
      close: SUNPHARMA_PRICE,
      volume: 2_000_000,
    };

    const entry = evaluateEntry(ta, SUNPHARMA_PRICE, bars, bearRegime, []);
    expect(entry.rules_passed).toBeGreaterThanOrEqual(6);
    expect(entry.deploy_scale).toBeCloseTo(0.8, 2);
    expect(entry.stop_loss).toBeCloseTo(1852.42, 2);
    expect(entry.profit_target).toBeCloseTo(2080.8, 1);
    expect(entry.r_multiple).toBeGreaterThanOrEqual(3.3);
  });
});

describe('parity — bear 52w band', () => {
  it('entry52wBand uses regime pct_52w bounds in bear', () => {
    const band = entry52wBand({ bear: true, pct_52w_min: 20, pct_52w_max: 55 });
    expect(band.min).toBe(20);
    expect(band.max).toBe(55);
  });
});
