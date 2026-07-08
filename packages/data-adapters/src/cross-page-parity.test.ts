import { describe, expect, it } from 'vitest';
import { estimate, runVerificationEngine, screenSymbol } from '@sv/core';
import { buildVerifierAutoFill } from './verifier-autofill.js';
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
  book_value: 296,
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
  book_value: 620,
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

  it('does not estimate ROCE from ROE when Screener ROCE is missing', () => {
    const metrics = mergeMetrics(
      'QUALITY',
      { ...TCS_YAHOO, roe: 45 },
      { ...TCS_SCREENER, roce: 0, roe: 45 },
    );

    expect(metrics.roe).toBe(45);
    expect(metrics.roce).toBe(0);
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

const TCS_AUTOFILL_BLOB = {
  company_name: 'Tata Consultancy Services',
  symbol: 'TCS',
  sector: 'IT',
  industry: 'IT Services',
  summary: 'Leading IT services company.',
  current_price: 4000,
  market_cap_cr: 1450000,
  eps: 120,
  eps_consolidated: 120,
  eps_standalone: 95,
  book_value: 250,
  book_value_consolidated: 250,
  book_value_standalone: 200,
  pe_ratio: 33,
  pb_ratio: 16,
  peg: 2.1,
  roe: 45,
  roce: 38,
  roa: 22,
  debt_to_equity: 0.05,
  revenue_growth: 8,
  revenue_growth_3yr: 10,
  eps_growth: 12,
  dividend_yield: 1.5,
  fcf_cr: 35000,
  cfo_cr: 40000,
  capex_cr: 5000,
  pat_cr: 42000,
  total_debt_cr: 2000,
  shareholders_equity_cr: 90000,
  promoter_pledge: 0,
  promoter_pledge_as_of: '',
  interest_coverage: 50,
  ebitda_margin: 28,
  gross_margin: 42,
  revenue_history: [150000, 165000, 180000, 195000, 210000],
  '52w_high': 4500,
  '52w_low': 3200,
};

function withManualGates(input: Record<string, string | number | boolean>) {
  return {
    ...input,
    p0_emergency_fund: true,
    p0_debt_cleared: true,
    p1_business_model: 'yes',
    p1_revenue_model: 'yes',
    p1_industry_outlook: 'growing',
    p1_circle_competence: 'yes',
    thesis_business: 'Quality IT compounder with durable moat and pricing power.',
    thesis_financials: 'ROE 45%, ROCE 38%, FCF conversion strong over 5 years.',
    thesis_valuation: 'DCF intrinsic shows MOS at current price with fair P/E anchor.',
    invalidation_1: 'Revenue decline two consecutive quarters',
    invalidation_2: 'Margin compression below sector median',
    review_date: '2027-01-01',
    manual_attestation: true,
  };
}

describe('full verify ↔ screener ↔ verify cross-page', () => {
  it('Full Verify re-run: same input → identical IV and scorecard (PHP verify ↔ index)', () => {
    const { input } = buildVerifierAutoFill(TCS_AUTOFILL_BLOB);
    const filled = withManualGates(input);
    const a = runVerificationEngine(filled);
    const b = runVerificationEngine(filled);
    expect(a.metrics.intrinsic_value).toBe(b.metrics.intrinsic_value);
    expect(a.metrics.margin_of_safety).toBe(b.metrics.margin_of_safety);
    expect(a.scorecard.total).toBe(b.scorecard.total);
  });

  it('Full Verify MOS consistent with intrinsic and price', () => {
    const { input } = buildVerifierAutoFill(TCS_AUTOFILL_BLOB);
    const engine = runVerificationEngine(withManualGates(input));
    const price = Number(input.current_price);
    const iv = engine.metrics.intrinsic_value;
    const impliedMos = iv > 0 ? ((iv - price) / iv) * 100 : 0;
    expect(engine.metrics.margin_of_safety).toBeCloseTo(impliedMos, 1);
  });

  it('TCS Yahoo fixture: screener row IV matches estimate (test-cross-page.php path)', () => {
    const metrics = mergeMetrics('TCS', TCS_YAHOO, TCS_SCREENER);
    const row = screenSymbol('TCS', metrics);
    const est = estimate(metrics);
    const ivTol = Math.max(1, est.intrinsic * 0.03);
    expect(row.intrinsic).toBeCloseTo(est.intrinsic, -Math.log10(ivTol));
    expect(row.mos).toBeCloseTo(est.mos ?? 0, 0);
  });

  it('standalone EPS changes Full Verify MOS vs consolidated', () => {
    const { input } = buildVerifierAutoFill(TCS_AUTOFILL_BLOB);
    const base = withManualGates(input);
    const cons = runVerificationEngine({ ...base, eps_mode: 'consolidated' });
    const stand = runVerificationEngine({ ...base, eps_mode: 'standalone' });
    expect(stand.metrics.eps_mode).toBe('standalone');
    expect(stand.metrics.margin_of_safety).not.toBe(cons.metrics.margin_of_safety);
  });
});
