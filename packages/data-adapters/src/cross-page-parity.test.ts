import { describe, expect, it } from 'vitest';
import { estimate, screenSymbol } from '@sv/core';
import { ivDeltaPercent, ivDriftHint, IV_DRIFT_WARN_PCT } from './live-parity.js';
import { mergeMetrics } from './stock-data-fetcher.js';
import type { YahooFundamentals } from './yahoo.js';
import type { ScreenerRatios } from './screener-in.js';

const TCS_YAHOO: YahooFundamentals = {
  symbol: 'TCS.NS',
  company_name: 'Tata Consultancy Services',
  sector: 'IT',
  industry: 'Software',
  price: 1800,
  eps: 135,
  book_value: 296,
  pe: 13.3,
  pb_ratio: 6.08,
  peg_ratio: 1.2,
  roe: 45,
  roa: 28,
  market_cap_cr: 800000,
  div_yield: 1.2,
  debt_to_equity: 0.05,
  revenue_growth: 9.6,
  eps_growth: 12.2,
  fcf_cr: 35000,
  cfo_cr: 42000,
  high_52w: 2100,
  low_52w: 1500,
  gross_margin: 38,
  ebitda_margin: 28,
  operating_margin: 26,
  interest_coverage: 100,
  total_debt_cr: 5000,
  total_cash_cr: 45000,
};

const TCS_SCREENER: ScreenerRatios = {
  roce: 45,
  roe: 45,
  pe: 13.3,
  sales_yoy: 9.6,
  profit_yoy: 12.2,
  debt_to_equity: 0.05,
  market_cap_cr: 800000,
};

const RELIANCE_YAHOO: YahooFundamentals = {
  symbol: 'RELIANCE.NS',
  company_name: 'Reliance Industries',
  sector: 'Oil & Gas',
  industry: 'Oil & Gas',
  price: 1280,
  eps: 49,
  book_value: 620,
  pe: 26,
  pb_ratio: 2.06,
  peg_ratio: 1.5,
  roe: 14,
  roa: 6,
  market_cap_cr: 1700000,
  div_yield: 0.4,
  debt_to_equity: 0.4,
  revenue_growth: 15,
  eps_growth: 12,
  fcf_cr: 80000,
  cfo_cr: 120000,
  high_52w: 1600,
  low_52w: 1100,
  gross_margin: 22,
  ebitda_margin: 16,
  operating_margin: 12,
  interest_coverage: 8,
  total_debt_cr: 280000,
  total_cash_cr: 190000,
};

const RELIANCE_SCREENER: ScreenerRatios = {
  roce: 11,
  roe: 14,
  pe: 26,
  sales_yoy: 15,
  profit_yoy: 12,
  debt_to_equity: 0.4,
  market_cap_cr: 1700000,
};

describe('cross-page parity — stock / screener / verify surfaces', () => {
  for (const [sym, yahoo, screener] of [
    ['TCS', TCS_YAHOO, TCS_SCREENER],
    ['RELIANCE', RELIANCE_YAHOO, RELIANCE_SCREENER],
  ] as const) {
    it(`${sym}: screener row IV matches verify estimate IV`, () => {
      const metrics = mergeMetrics(sym, yahoo, screener);
      const row = screenSymbol(sym, metrics);
      const verify = estimate(metrics);
      expect(row.intrinsic).toBeCloseTo(verify.intrinsic, 0);
      expect(row.mos).toBeCloseTo(verify.mos ?? 0, 0);
    });
  }

  it('ivDeltaPercent matches PHP LiveParityChecker formula', () => {
    expect(ivDeltaPercent(1000, 1100)).toBeCloseTo(9.1, 0);
    expect(ivDeltaPercent(1200, 1000)).toBeCloseTo(20, 0);
  });

  it('ivDriftHint warns above threshold', () => {
    const hint = ivDriftHint(1000, 1100);
    expect(hint).not.toBeNull();
    expect(hint!.iv_drift_warn).toBe(hint!.drift_pct > IV_DRIFT_WARN_PCT);
  });

  it('TCS fixture MOS near PHP validate-logic (~17%)', () => {
    const est = estimate({
      symbol: 'TCS',
      price: 1800,
      pe: 13.3,
      eps: 135,
      book_value: 296,
      sector: 'it',
      roe: 45,
      roce: 45,
      market_cap_cr: 800000,
      sales_yoy: 9.6,
      profit_yoy: 12.2,
      altman_z: 3.1,
      z_score_source: 'estimated',
    });
    expect(est.mos).toBeCloseTo(17.2, 0);
    expect(est.intrinsic).toBeCloseTo(2175, 0);
  });
});
