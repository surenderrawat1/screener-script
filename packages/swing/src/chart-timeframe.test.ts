import { describe, expect, it } from 'vitest';
import {
  isSwingChartIntraday,
  normalizeSwingChartTimeframe,
  swingChartMinBars,
  swingChartYahooParams,
} from './chart-timeframe.js';

describe('chart-timeframe', () => {
  it('normalizes daily and intraday timeframes', () => {
    expect(normalizeSwingChartTimeframe('6m')).toBe('6mo');
    expect(normalizeSwingChartTimeframe('6mo')).toBe('6mo');
    expect(normalizeSwingChartTimeframe('1y')).toBe('1y');
    expect(normalizeSwingChartTimeframe('2y')).toBe('2y');
    expect(normalizeSwingChartTimeframe('5y')).toBe('5y');
    expect(normalizeSwingChartTimeframe('1h')).toBe('1h');
    expect(normalizeSwingChartTimeframe('60d')).toBe('1h');
    expect(normalizeSwingChartTimeframe('5m')).toBe('5m');
    expect(normalizeSwingChartTimeframe('15m')).toBe('15m');
    expect(normalizeSwingChartTimeframe('4h')).toBe('4h');
    expect(normalizeSwingChartTimeframe('240m')).toBe('4h');
    expect(normalizeSwingChartTimeframe('1w')).toBe('1w');
    expect(normalizeSwingChartTimeframe('weekly')).toBe('1w');
    expect(normalizeSwingChartTimeframe('')).toBe('2y');
  });

  it('maps Yahoo interval/range for all swing chart frames', () => {
    expect(swingChartYahooParams('2y')).toEqual({ interval: '1d', range: '2y' });
    expect(swingChartYahooParams('1h')).toEqual({ interval: '60m', range: '60d' });
    expect(swingChartYahooParams('5m')).toEqual({ interval: '5m', range: '5d' });
    expect(swingChartYahooParams('15m')).toEqual({ interval: '15m', range: '5d' });
    expect(swingChartYahooParams('4h')).toEqual({ interval: '240m', range: '60d' });
    expect(swingChartYahooParams('1w')).toEqual({ interval: '1wk', range: '5y' });
  });

  it('classifies intraday frames', () => {
    expect(isSwingChartIntraday('5m')).toBe(true);
    expect(isSwingChartIntraday('4h')).toBe(true);
    expect(isSwingChartIntraday('2y')).toBe(false);
    expect(isSwingChartIntraday('1w')).toBe(false);
  });

  it('uses lower min bars for short intraday series', () => {
    expect(swingChartMinBars('5m')).toBe(20);
    expect(swingChartMinBars('2y')).toBe(30);
  });
});
