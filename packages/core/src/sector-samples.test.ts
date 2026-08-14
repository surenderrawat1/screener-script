import { describe, expect, it } from 'vitest';
import { buildStockMetrics } from './screener.js';

const SECTOR_REPS: Array<{ sector: string; symbol: string }> = [
  { sector: 'banking', symbol: 'SBIN' },
  { sector: 'it', symbol: 'TCS' },
  { sector: 'auto', symbol: 'MARUTI' },
  { sector: 'oil_gas', symbol: 'ONGC' },
  { sector: 'insurance', symbol: 'SBILIFE' },
  { sector: 'nbfc', symbol: 'BAJFINANCE' },
  { sector: 'metal', symbol: 'TATASTEEL' },
  { sector: 'cement', symbol: 'ULTRACEMCO' },
  { sector: 'telecom', symbol: 'BHARTIARTL' },
  { sector: 'utility', symbol: 'NTPC' },
  { sector: 'reit', symbol: 'NHIT' },
  { sector: 'infra', symbol: 'LT' },
  { sector: 'fmcg', symbol: 'ITC' },
  { sector: 'pharma', symbol: 'SUNPHARMA' },
  { sector: 'defence', symbol: 'HAL' },
];

describe('sector sample fallbacks', () => {
  it.each(SECTOR_REPS)('provides core display fundamentals for $symbol ($sector)', ({ symbol }) => {
    const metrics = buildStockMetrics(symbol);
    expect(metrics.market_cap_cr).toBeGreaterThan(0);
    expect(metrics.pe).toBeGreaterThan(0);
    expect(metrics.roe).toBeGreaterThan(0);
    expect(metrics.roce).toBeGreaterThan(0);
    expect(metrics.sector).not.toBe('general');
    expect(String(metrics.industry ?? '').length).toBeGreaterThan(0);
  });
});
