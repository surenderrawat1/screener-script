import { describe, expect, it } from 'vitest';
import type { StockMetrics } from '@sv/shared';
import { buildMetricsFromScreenerFallback, mergeScreenerRatiosIntoMetrics } from './screener-run.js';

describe('mergeScreenerRatiosIntoMetrics', () => {
  it('fills missing Yahoo fundamentals from Screener.in ratios', () => {
    const base: StockMetrics = {
      symbol: 'TCS',
      price: 4000,
      pe: 0,
      eps: 0,
      roe: 0,
      roce: 0,
      market_cap_cr: 0,
    };
    const merged = mergeScreenerRatiosIntoMetrics(base, {
      roce: 42,
      roe: 38,
      pe: 28,
      book_value: 250,
      sales_yoy: 12,
      profit_yoy: 10,
      debt_to_equity: 0.1,
      market_cap_cr: 1400000,
    });
    expect(merged.roce).toBe(42);
    expect(merged.roe).toBe(38);
    expect(merged.pe).toBe(28);
    expect(merged.market_cap_cr).toBe(1400000);
    expect(merged.eps).toBeCloseTo(4000 / 28, 4);
  });

  it('does not overwrite existing Yahoo values', () => {
    const base: StockMetrics = {
      symbol: 'TCS',
      price: 4000,
      pe: 30,
      eps: 133,
      roe: 35,
      roce: 40,
      market_cap_cr: 1200000,
    };
    const merged = mergeScreenerRatiosIntoMetrics(base, {
      roce: 99,
      roe: 99,
      pe: 99,
      book_value: 1,
      sales_yoy: 0,
      profit_yoy: 0,
      debt_to_equity: 0,
      market_cap_cr: 1,
    });
    expect(merged.roce).toBe(40);
    expect(merged.pe).toBe(30);
  });

  it('builds CFA metrics from Screener.in ratios when Yahoo price is unavailable elsewhere', () => {
    const metrics = buildMetricsFromScreenerFallback(
      'TCS',
      {
        roce: 42,
        roe: 38,
        pe: 28,
        book_value: 250,
        sales_yoy: 12,
        profit_yoy: 10,
        debt_to_equity: 0.1,
        market_cap_cr: 1400000,
      },
      4000,
      'Tata Consultancy Services',
    );
    expect(metrics.symbol).toBe('TCS');
    expect(metrics.price).toBe(4000);
    expect(metrics.roe).toBe(38);
    expect(metrics.roce).toBe(42);
    expect(metrics.pe).toBe(28);
    expect(metrics.eps).toBeCloseTo(4000 / 28, 4);
    expect(metrics.market_cap_cr).toBe(1400000);
  });
});
