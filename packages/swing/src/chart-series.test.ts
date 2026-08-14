import { describe, expect, it } from 'vitest';
import { buildSwingChartPayload, rsiLineSeriesFromBars } from './chart-series.js';
import { rsi } from './ta-helper.js';
import type { OhlcBar } from './types.js';

function fakeBars(n: number): OhlcBar[] {
  const bars: OhlcBar[] = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    px += (i % 3 === 0 ? 1.2 : -0.7);
    bars.push({
      time: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
      open: px - 0.5,
      high: px + 1,
      low: px - 1,
      close: px,
      volume: 1_000_000,
    });
  }
  return bars;
}

describe('rsiLineSeriesFromBars', () => {
  it('aligns last RSI with ta-helper rsi()', () => {
    const bars = fakeBars(40);
    const series = rsiLineSeriesFromBars(bars, 14, false);
    expect(series.length).toBeGreaterThan(10);
    const last = series[series.length - 1]?.value;
    expect(last).toBe(rsi(bars.map((b) => b.close), 14));
  });

  it('includes rsi14 on swing chart payload', () => {
    const payload = buildSwingChartPayload(fakeBars(60), 'TCS', '1y');
    expect(payload.rsi14.length).toBeGreaterThan(0);
    expect(payload.rsi14[payload.rsi14.length - 1]?.value).toBeGreaterThanOrEqual(0);
    expect(payload.rsi14[payload.rsi14.length - 1]?.value).toBeLessThanOrEqual(100);
  });
});
