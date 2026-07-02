import { describe, expect, it } from 'vitest';
import { defaultRegime, regimeFromBars } from './market-regime.js';
import type { OhlcBar } from './types.js';

function syntheticBars(trend: 'up' | 'down' | 'flat', count = 260): OhlcBar[] {
  const bars: OhlcBar[] = [];
  let price = trend === 'down' ? 120 : 80;
  for (let i = 0; i < count; i++) {
    if (trend === 'up') price *= 1.002;
    else if (trend === 'down') price *= 0.998;
    else price += Math.sin(i / 8) * 0.05;
    bars.push({
      time: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
      open: price,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      volume: 1_000_000,
    });
  }
  return bars;
}

describe('market regime', () => {
  it('defaultRegime is sideways', () => {
    const r = defaultRegime();
    expect(r.key).toBe('sideways');
    expect(r.blocks_strict_enter).toBe(false);
    expect(r.pct_52w_min).toBe(32);
  });

  it('regimeFromBars returns empty_bars fallback', () => {
    const r = regimeFromBars([]);
    expect(r.reason).toBe('empty_bars');
  });

  it('regimeFromBars detects bull on sustained uptrend', () => {
    const r = regimeFromBars(syntheticBars('up'));
    expect(r.bull).toBe(true);
    expect(r.key).toBe('bull');
  });

  it('regimeFromBars detects bear on sustained downtrend', () => {
    const r = regimeFromBars(syntheticBars('down'));
    expect(r.bear).toBe(true);
    expect(['bear', 'strong_bear']).toContain(r.key);
  });
});
