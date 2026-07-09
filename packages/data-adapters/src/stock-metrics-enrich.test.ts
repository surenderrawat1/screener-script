import { describe, expect, it } from 'vitest';
import { enrichStockMetrics } from './stock-metrics-enrich.js';

describe('enrichStockMetrics', () => {
  it('fills book value and sector from Screener annual', () => {
    const out = enrichStockMetrics(
      {
        symbol: 'TCS',
        name: 'TCS',
        price: 2000,
        market_cap_cr: 750000,
        pe: 15,
        eps: 130,
        sector: 'general',
        book_value: 0,
        fcf_cr: 0,
        cfo_cr: 0,
      },
      {
        revenue_history: [200000, 220000, 240000, 260000],
        pat_history: [40000, 42000, 45000, 48000],
        shareholders_equity_cr: 100000,
        summary: 'IT services',
        company_name: 'Tata Consultancy Services',
        industry: 'Information Technology Services',
        fcf_cr: 36000,
        cfo_cr: 50000,
      },
      { symbol: 'TCS' },
    );

    expect(out.sector).toBe('it');
    expect(out.book_value).toBeGreaterThan(200);
    expect(out.fcf_cr).toBe(36000);
    expect(out.sales_yoy).toBeGreaterThan(0);
    expect(out.industry).toContain('Technology');
  });

  it('derives display fundamentals from price and ratios when live data is sparse', () => {
    const out = enrichStockMetrics(
      {
        symbol: 'SBIN',
        name: 'SBIN',
        price: 1000,
        pe: 20,
        roe: 15,
        roce: 14,
        sales_yoy: 8,
        profit_yoy: 8,
        sector: 'general',
      },
      null,
      { symbol: 'SBIN' },
    );

    expect(out.eps).toBe(50);
    expect(out.book_value).toBe(333.33);
    expect(out.pb_ratio).toBe(3);
    expect(out.sector).toBe('banking');
    expect(out.industry).toBe('Banking / Financial Services');
  });
});
