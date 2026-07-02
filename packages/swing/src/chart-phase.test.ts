import { describe, expect, it } from 'vitest';
import { chartPhaseAnalysis } from './chart-phase.js';
import { buildDailyChartPayload } from './chart-series.js';
import type { OhlcBar } from './types.js';

describe('chartPhaseAnalysis', () => {
  function syntheticBars(count: number, start = 100, drift = 0.2): OhlcBar[] {
    const bars: OhlcBar[] = [];
    let price = start;
    for (let i = 0; i < count; i++) {
      price += drift + (i % 7 === 0 ? -1.5 : 0);
      const d = new Date(Date.UTC(2023, 0, 2 + i));
      bars.push({
        time: d.toISOString().slice(0, 10),
        open: price - 0.5,
        high: price + 1,
        low: price - 1,
        close: price,
        volume: 1_000_000,
      });
    }
    return bars;
  }

  it('returns empty state when ta not ready', () => {
    const result = chartPhaseAnalysis(100, { ta_ready: false }, null);
    expect(result.ready).toBe(false);
    expect(result.phases).toHaveLength(0);
  });

  it('produces six phases when data is sufficient', () => {
    const bars = syntheticBars(260, 80, 0.35);
    const chart = buildDailyChartPayload(bars, 'TEST');
    const price = bars[bars.length - 1].close;
    const ta = {
      ta_ready: true,
      ta_sma9: price,
      ta_sma50: price * 0.95,
      ta_sma200: price * 0.9,
      ta_rsi14: 55,
      ta_pct_52w: 62,
      ta_bb_pct_b: 55,
      ta_macd_hist: 0.5,
      ta_above_sma50: true,
      ta_above_sma200: true,
    };
    const result = chartPhaseAnalysis(price, ta, chart);
    expect(result.ready).toBe(true);
    expect(result.phases).toHaveLength(6);
    expect(['bullish', 'bearish', 'neutral']).toContain(result.bias);
    expect(result.headline).toMatch(/^Chart bias:/);
  });

  it('detects primary downtrend when price below SMA-200', () => {
    const bars = syntheticBars(260, 200, -0.4);
    const chart = buildDailyChartPayload(bars, 'TEST');
    const price = bars[bars.length - 1].close;
    const ta = {
      ta_ready: true,
      ta_sma50: price * 1.05,
      ta_sma200: price * 1.1,
      ta_rsi14: 38,
      ta_pct_52w: 20,
      ta_bb_pct_b: 25,
      ta_macd_hist: -0.3,
      ta_above_sma50: false,
      ta_above_sma200: false,
    };
    const result = chartPhaseAnalysis(price, ta, chart);
    expect(result.phases[0]?.label).toBe('Primary downtrend');
    expect(result.bias).toBe('bearish');
  });
});
