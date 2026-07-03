import { describe, expect, it } from 'vitest';
import { PRESET_FILTERS, SCREENER_PRESET_KEYS } from './screener-presets.js';
import { passesFilters, screenSymbol } from './screener.js';

describe('screener-presets', () => {
  it('ships 22 preset keys', () => {
    expect(SCREENER_PRESET_KEYS.length).toBeGreaterThanOrEqual(22);
    expect(PRESET_FILTERS.moat_compounders?.min_moat_tier).toBe('strong');
    expect(PRESET_FILTERS.defensive?.min_div_yield).toBe(1.5);
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
