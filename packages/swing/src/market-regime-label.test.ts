import { describe, expect, it } from 'vitest';
import { formatRegimeLabel, regimeFromBars, defaultRegime } from './market-regime.js';
import type { OhlcBar } from './types.js';

describe('formatRegimeLabel', () => {
  it('appends NIFTYBEES proxy suffix for PHP KPI parity', () => {
    expect(formatRegimeLabel({ label: 'Bear', proxy: 'NIFTYBEES' })).toBe('Bear (NIFTYBEES)');
    expect(formatRegimeLabel(regimeFromBars(bearBars()))).toMatch(/\(NIFTYBEES\)$/);
    expect(formatRegimeLabel(defaultRegime())).toBe('Sideways (default) (NIFTYBEES)');
  });
});

function bearBars(): OhlcBar[] {
  const bars: OhlcBar[] = [];
  for (let i = 0; i < 220; i++) {
    const close = 240 - i * 0.05;
    bars.push({
      time: `2025-${String((i % 12) + 1).padStart(2, '0')}-01`,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000_000,
    });
  }
  return bars;
}
