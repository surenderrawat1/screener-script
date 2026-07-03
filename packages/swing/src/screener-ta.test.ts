import { describe, expect, it } from 'vitest';
import { passesTaFilters, taFiltersActive } from './screener-ta.js';

describe('taFiltersActive', () => {
  it('detects RSI band presets', () => {
    expect(taFiltersActive({ min_rsi: 25, max_rsi: 45 })).toBe(true);
    expect(taFiltersActive({ min_roe: 15 } as never)).toBe(false);
  });
});

describe('passesTaFilters', () => {
  const baseTa = {
    ta_ready: true,
    ta_rsi14: 35,
    ta_pct_52w: 30,
    ta_macd_bullish: true,
    ta_above_sma50: true,
    ta_above_sma200: true,
    ta_bb_pct_b: 20,
    ta_bottom_out_hint: true,
    ta_bottom_out_score: 4,
    ta_52w_chart_zone: 'green',
    ta_golden_cross_50_200: true,
  };

  it('passes ta_pullback band', () => {
    expect(
      passesTaFilters(baseTa, { min_rsi: 25, max_rsi: 45, max_pct_52w: 35 }),
    ).toBe(true);
  });

  it('fails when RSI too high for pullback', () => {
    expect(
      passesTaFilters({ ...baseTa, ta_rsi14: 55 }, { min_rsi: 25, max_rsi: 45 }),
    ).toBe(false);
  });

  it('fails when TA data missing', () => {
    expect(passesTaFilters({ ta_ready: false }, { min_rsi: 25 })).toBe(false);
  });

  it('requires bottom-out hint when set', () => {
    expect(passesTaFilters({ ...baseTa, ta_bottom_out_hint: false }, { bottom_out_hint: true })).toBe(
      false,
    );
  });
});
