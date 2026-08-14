import { describe, expect, it } from 'vitest';
import {
  FRESH_CROSS_DEFAULT_BARS,
  passesFreshCross,
  priceMaCrossBarsAgo,
  priceMaCrossMetrics,
} from './price-ma-cross.js';
import { passesTaFilters, taFiltersActive } from './screener-ta.js';
import type { OhlcBar } from './types.js';

function barsFromCloses(closes: number[]): OhlcBar[] {
  return closes.map((close, i) => ({
    time: `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  }));
}

describe('priceMaCrossBarsAgo', () => {
  it('detects fresh cross above SMA-20 on latest bar', () => {
    // 20 flat closes at 100, then 101 — last bar crosses above SMA≈100
    const closes = [...Array(20).fill(100), 101];
    expect(priceMaCrossBarsAgo(closes, 20, 'above', 'sma', 3)).toBe(0);
  });

  it('detects cross below SMA-20', () => {
    const closes = [...Array(20).fill(100), 99];
    expect(priceMaCrossBarsAgo(closes, 20, 'below', 'sma', 3)).toBe(0);
  });

  it('detects fresh cross above/below EMA-20', () => {
    const flat = Array(40).fill(100);
    expect(priceMaCrossBarsAgo([...flat, 101], 20, 'above', 'ema', 5)).toBe(0);
    expect(priceMaCrossBarsAgo([...flat, 99], 20, 'below', 'ema', 5)).toBe(0);
  });

  it('gates screener on fresh cross_above_ema20 and hourly EMA', () => {
    expect(
      passesTaFilters(
        { ta_ready: true, ta_cross_above_ema20_bars: 1 },
        { cross_above_ema20: true, fresh_cross_bars: 3 },
      ),
    ).toBe(true);
    expect(
      passesTaFilters(
        { ta_ready: true, ta_cross_above_ema20_bars: null },
        { cross_above_ema20: true, fresh_cross_bars: 3 },
      ),
    ).toBe(false);
    expect(
      passesTaFilters(
        { ta_ready: true, ta_h_cross_above_ema20_bars: 0 },
        { hourly_cross_above_ema20: true, fresh_cross_bars: 3 },
      ),
    ).toBe(true);
    expect(
      passesTaFilters(
        { ta_ready: true, ta_cross_above_ema20_bars: 0 },
        { hourly_cross_above_ema20: true, fresh_cross_bars: 3 },
      ),
    ).toBe(false);
  });

  it('returns null when no fresh cross', () => {
    const closes = Array(30).fill(100);
    expect(priceMaCrossBarsAgo(closes, 20, 'above', 'sma', 3)).toBeNull();
  });

  it('finds cross a few bars ago within lookback', () => {
    // Cross at index 20 (barsAgo=2 when length=23)
    const closes = [...Array(20).fill(100), 101, 102, 103];
    expect(priceMaCrossBarsAgo(closes, 20, 'above', 'sma', 5)).toBe(2);
  });
});

describe('priceMaCrossMetrics + screener filters', () => {
  it('sets daily cross flags for enrich metrics', () => {
    const closes = [...Array(20).fill(100), 101];
    const m = priceMaCrossMetrics(barsFromCloses(closes), '');
    expect(m.ta_cross_above_sma20_bars).toBe(0);
    expect(m.ta_cross_above_sma20).toBe(true);
  });

  it('gates screener on fresh cross_above_sma20', () => {
    expect(taFiltersActive({ cross_above_sma20: true })).toBe(true);
    expect(
      passesTaFilters(
        { ta_ready: true, ta_cross_above_sma20_bars: 0 },
        { cross_above_sma20: true, fresh_cross_bars: 3 },
      ),
    ).toBe(true);
    expect(
      passesTaFilters(
        { ta_ready: true, ta_cross_above_sma20_bars: 4 },
        { cross_above_sma20: true, fresh_cross_bars: 3 },
      ),
    ).toBe(false);
  });

  it('gates hourly cross keys', () => {
    expect(taFiltersActive({ hourly_cross_above_sma50: true })).toBe(true);
    expect(
      passesTaFilters(
        { ta_ready: true, ta_h_cross_above_sma50_bars: 1 },
        { hourly_cross_above_sma50: true, fresh_cross_bars: 3 },
      ),
    ).toBe(true);
  });

  it('passesFreshCross respects window', () => {
    expect(passesFreshCross(0, FRESH_CROSS_DEFAULT_BARS)).toBe(true);
    expect(passesFreshCross(2, 3)).toBe(true);
    expect(passesFreshCross(3, 3)).toBe(false);
    expect(passesFreshCross(null, 3)).toBe(false);
  });
});
