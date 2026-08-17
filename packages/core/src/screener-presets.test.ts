import { describe, expect, it } from 'vitest';
import { PRESET_FILTERS, SCREENER_PRESET_KEYS } from './screener-presets.js';
import { passesFilters, screenSymbol } from './screener.js';

describe('screener-presets', () => {
  it('ships PHP-parity preset keys (≥30)', () => {
    expect(SCREENER_PRESET_KEYS.length).toBeGreaterThanOrEqual(30);
    expect(PRESET_FILTERS.moat_compounders?.min_moat_tier).toBe('strong');
    expect(PRESET_FILTERS.defensive?.min_div_yield).toBe(1.5);
    expect(PRESET_FILTERS.ta_technical?.technical_only).toBe(true);
    expect(PRESET_FILTERS.cfa_ltg_auto?.min_score).toBe(65);
    expect(PRESET_FILTERS.cfa_moat_reversal?.bottom_out_hint).toBe(true);
  });

  it('defensive filter rejects low div yield', () => {
    const row = screenSymbol('TCS', {
      symbol: 'TCS',
      price: 100,
      pe: 18,
      roe: 20,
      roce: 18,
      div_yield: 0.5,
      market_cap_cr: 10000,
    });
    expect(passesFilters(row, PRESET_FILTERS.defensive)).toBe(false);
  });
});
