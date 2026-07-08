import { describe, expect, it } from 'vitest';
import { normalizeSwingChartTimeframe, swingChartYahooParams } from './chart-timeframe.js';

describe('chart-timeframe', () => {
  it('normalizes PHP parity timeframes', () => {
    expect(normalizeSwingChartTimeframe('6m')).toBe('6mo');
    expect(normalizeSwingChartTimeframe('6mo')).toBe('6mo');
    expect(normalizeSwingChartTimeframe('1y')).toBe('1y');
    expect(normalizeSwingChartTimeframe('2y')).toBe('2y');
    expect(normalizeSwingChartTimeframe('5y')).toBe('5y');
    expect(normalizeSwingChartTimeframe('1h')).toBe('1h');
    expect(normalizeSwingChartTimeframe('60d')).toBe('1h');
    expect(normalizeSwingChartTimeframe('')).toBe('2y');
  });

  it('maps Yahoo interval/range', () => {
    expect(swingChartYahooParams('2y')).toEqual({ interval: '1d', range: '2y' });
    expect(swingChartYahooParams('1h')).toEqual({ interval: '60m', range: '60d' });
  });
});
