import { describe, expect, it } from 'vitest';
import { applyCfaScreeningDefaults } from './cfa-screening-defaults.js';
import { buildInvestmentMemo } from './investment-memo.js';
import { runVerificationEngine } from './verification/index.js';

describe('buildInvestmentMemo', () => {
  it('builds pillars and uses engine verdict action', () => {
    const input = applyCfaScreeningDefaults(
      {
        stock_name: 'TCS',
        sector: 'it',
        current_price: 2035,
        eps: 136,
        book_value_latest: 296,
        pe_ratio: 15,
        roe: 48,
        roce: 41,
        debt_to_equity: 0.1,
        fcf: 37000,
        cfo: 52000,
        piotroski_score: 8,
        p2_revenue_growing: 'yes',
        p2_pat_quality: 'yes',
        p2_fcf_positive: 'yes',
      },
      { sector: 'it', market_cap_cr: 750000, revenue_growth: 8, roe: 48, summary: 'IT services' },
    );

    const result = runVerificationEngine(input, {
      sectorHints: { TCS: 'it' },
      screening_mode: true,
      cacheMeta: { created_at: Math.floor(Date.now() / 1000) },
    });

    const memo = buildInvestmentMemo(
      result,
      { current_price: 2035, industry: 'IT Services', sector: 'it', roe: 48, roce: 41 },
      input,
    );

    expect(memo.quality.score).toBeGreaterThan(70);
    expect(Object.keys(memo.pillars).length).toBeGreaterThan(0);
    expect(memo.valuation.intrinsic).toBeGreaterThan(0);
    expect([
      'WAIT',
      'BUY',
      'STRONG BUY',
      'STAGGERED BUY',
      'AVOID NEW',
      'REJECT',
      'EXIT',
    ]).toContain(result.verdict.action);
    expect(memo.verdict).toBeTruthy();
  });
});
