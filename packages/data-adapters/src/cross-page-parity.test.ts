import { describe, expect, it } from 'vitest';
import { estimate, runVerificationEngine, screenSymbol } from '@sv/core';
import { buildVerifierAutoFill } from './verifier-autofill.js';
import { ivDeltaPercent, ivDriftHint, IV_DRIFT_WARN_PCT } from './live-parity.js';
import { mergeMetrics } from './stock-data-fetcher.js';
import type { YahooFundamentals } from './yahoo.js';
import type { ScreenerRatios } from './screener-in.js';
import type { ScreenerAnnualFinancials } from './screener-annual.js';
import { enrichStockMetrics } from './stock-metrics-enrich.js';
import {
  applyScreenerWarningsToVerifierAutofill,
  classifyScreenerCons,
} from './screener-insights.js';
import {
  applyShareholdingVerifierPatches,
  parseScreenerShareholding,
} from './screener-shareholding.js';

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

const HDFCBANK_SCREENER: ScreenerRatios = {
  roce: 18,
  roe: 16,
  pe: 18,
  book_value: 380,
  sales_yoy: 22,
  profit_yoy: 18,
  debt_to_equity: 0,
  market_cap_cr: 1200000,
};

const HDFCBANK_YAHOO: YahooFundamentals = {
  symbol: 'HDFCBANK.NS',
  company_name: 'HDFC Bank',
  sector: 'Financial Services',
  industry: 'Banks',
  price: 1650,
  eps: 92,
  book_value: 380,
  pe: 18,
  pb_ratio: 4.3,
  peg_ratio: 1.1,
  roe: 16,
  roa: 1.8,
  market_cap_cr: 1200000,
  div_yield: 1.1,
  debt_to_equity: 0,
  revenue_growth: 22,
  eps_growth: 18,
  fcf_cr: 0,
  cfo_cr: 85000,
  high_52w: 1850,
  low_52w: 1400,
  gross_margin: 0,
  ebitda_margin: 0,
  operating_margin: 0,
  interest_coverage: 0,
  total_debt_cr: 0,
  total_cash_cr: 120000,
};

describe('cross-page parity — stock / screener / verify surfaces', () => {
  for (const [sym, yahoo, screener] of [
    ['TCS', TCS_YAHOO, TCS_SCREENER],
    ['RELIANCE', RELIANCE_YAHOO, RELIANCE_SCREENER],
    ['HDFCBANK', HDFCBANK_YAHOO, HDFCBANK_SCREENER],
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


const RELIANCE_ANNUAL: ScreenerAnnualFinancials = {
  revenue_history: [],
  pat_history: [],
  shareholders_equity_cr: 0,
  summary: '',
  company_name: 'Reliance Industries',
  industry: 'Oil & Gas',
  promoter_holding_pct: 50.0,
  promoter_pledge_pct: undefined,
  pros: [],
  cons: [
    'Company has a low return on equity of 8.77% over last 3 years.',
    'Dividend payout has been low at 10.2% of profits over last 3 years',
  ],
  shareholding: parseScreenerShareholding(`
<section id="shareholding"><table><thead><tr>
  <th></th><th>Dec 2024</th><th>Mar 2025</th><th>Jun 2025</th><th>Sep 2025</th>
</tr></thead><tbody>
  <tr><td class="text">Promoters+</td><td>50.90</td><td>50.70</td><td>50.60</td><td>50.00</td></tr>
  <tr><td class="text">FIIs+</td><td>22.10</td><td>22.40</td><td>22.80</td><td>23.50</td></tr>
  <tr><td class="text">DIIs+</td><td>16.00</td><td>15.90</td><td>15.70</td><td>15.40</td></tr>
</tbody></table></section>
`) ?? undefined,
};

const HDFCBANK_ANNUAL: ScreenerAnnualFinancials = {
  revenue_history: [],
  pat_history: [],
  shareholders_equity_cr: 0,
  summary: '',
  company_name: 'HDFC Bank',
  industry: 'Banks',
  promoter_holding_pct: 0,
  promoter_pledge_pct: 0,
  promoter_pledge_as_of: '2025-09-30',
  pros: ['Company has delivered good profit growth of 18.9% CAGR over last 5 years'],
  cons: [
    'Company has low interest coverage ratio.',
    'Contingent liabilities of Rs.35,61,957 Cr.',
    'Earnings include an other income of Rs.1,43,700 Cr.',
  ],
  shareholding: parseScreenerShareholding(`
<section id="shareholding"><table><thead><tr>
  <th></th><th>Dec 2024</th><th>Mar 2025</th><th>Jun 2025</th><th>Sep 2025</th>
</tr></thead><tbody>
  <tr><td class="text">Promoters+</td><td>0</td><td>0</td><td>0</td><td>0</td></tr>
  <tr><td class="text">FIIs+</td><td>48.00</td><td>49.00</td><td>50.00</td><td>52.10</td></tr>
  <tr><td class="text">DIIs+</td><td>30.00</td><td>29.50</td><td>29.00</td><td>28.20</td></tr>
</tbody></table></section>
`) ?? undefined,
};

describe('cross-page governance fixtures — RELIANCE / HDFCBANK', () => {
  it('RELIANCE: unknown pledge stays unset (not false 0% pass)', () => {
    const metrics = enrichStockMetrics(
      mergeMetrics('RELIANCE', RELIANCE_YAHOO, RELIANCE_SCREENER),
      RELIANCE_ANNUAL,
      { symbol: 'RELIANCE' },
    );
    expect(metrics.promoter_pledge).toBeUndefined();
    expect(metrics.screener_has_watch).toBe(true);
    expect(metrics.screener_has_critical).toBe(false);

    const row = screenSymbol('RELIANCE', metrics);
    expect(row.promoter_pledge).toBeUndefined();
    expect(row.screener_has_watch).toBe(true);
    expect(row.screener_warnings?.some((w) => w.label === 'Low ROE')).toBe(true);
  });

  it('RELIANCE: declining promoter holding patches Full Verify Phase 1.5', () => {
    const metrics = enrichStockMetrics(
      mergeMetrics('RELIANCE', RELIANCE_YAHOO, RELIANCE_SCREENER),
      RELIANCE_ANNUAL,
      { symbol: 'RELIANCE' },
    );
    expect(metrics.promoter_holding_trend).toBe('declining');
    const { input, adjustments } = applyShareholdingVerifierPatches({}, [], metrics.shareholding as never);
    expect(input.p1_promoter_stable).toBe('no');
    expect(adjustments.some((a) => a.field === 'p1_promoter_stable')).toBe(true);
  });

  it('HDFCBANK: pledge 0% from Screener is known zero, not unknown', () => {
    const metrics = enrichStockMetrics(
      mergeMetrics('HDFCBANK', HDFCBANK_YAHOO, HDFCBANK_SCREENER),
      HDFCBANK_ANNUAL,
      { symbol: 'HDFCBANK' },
    );
    expect(metrics.promoter_pledge).toBe(0);
    expect(metrics.promoter_pledge_source).toBe('screener.in');

    const row = screenSymbol('HDFCBANK', metrics);
    expect(row.promoter_pledge).toBe(0);
  });

  it('HDFCBANK: Screener cons → Full Verify soft gates (contingent / coverage / earnings)', () => {
    const warnings = classifyScreenerCons(HDFCBANK_ANNUAL.cons ?? []);
    const base = {
      p2_contingent_ok: '1',
      p2_accounting_ok: '1',
      p2_pat_quality: 'yes',
      interest_coverage: 8,
    };
    const { input, adjustments } = applyScreenerWarningsToVerifierAutofill(base, [], warnings);
    expect(input.p2_contingent_ok).toBe('0');
    expect(input.interest_coverage).toBe(2);
    expect(input.p2_pat_quality).toBe('no');
    expect(adjustments.length).toBeGreaterThanOrEqual(3);

    const metrics = enrichStockMetrics(
      mergeMetrics('HDFCBANK', HDFCBANK_YAHOO, HDFCBANK_SCREENER),
      HDFCBANK_ANNUAL,
      { symbol: 'HDFCBANK' },
    );
    const row = screenSymbol('HDFCBANK', metrics);
    const verify = estimate(metrics);
    expect(row.intrinsic).toBeCloseTo(verify.intrinsic, 0);
    expect(row.screener_has_watch).toBe(true);
  });

  it('critical pledge cons escalate screener_has_critical on row', () => {
    const metrics = enrichStockMetrics(
      mergeMetrics('RELIANCE', RELIANCE_YAHOO, RELIANCE_SCREENER),
      {
        ...RELIANCE_ANNUAL,
        cons: ['Promoters have pledged 100% of their holding.'],
        promoter_pledge_pct: 100,
        promoter_pledge_as_of: '2025-09-30',
      },
      { symbol: 'RELIANCE' },
    );
    expect(metrics.screener_has_critical).toBe(true);
    expect(metrics.promoter_pledge).toBe(100);
    const row = screenSymbol('RELIANCE', metrics);
    expect(row.screener_has_critical).toBe(true);
    expect(row.promoter_pledge).toBe(100);
  });
});
