import { describe, expect, it } from 'vitest';
import { buildVerifierAutoFill, mapToVerifierInput, metricsToVerifierBlob } from './verifier-autofill.js';

const TCS_BLOB = {
  company_name: 'Tata Consultancy Services',
  symbol: 'TCS',
  sector: 'IT',
  industry: 'IT Services',
  summary: 'Leading IT services company.',
  current_price: 4000,
  market_cap_cr: 1450000,
  eps: 120,
  eps_consolidated: 120,
  eps_standalone: 0,
  book_value: 250,
  book_value_consolidated: 250,
  book_value_standalone: 0,
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

describe('buildVerifierAutoFill', () => {
  it('returns input with auto_keys for TCS fixture', () => {
    const { input, auto_keys } = buildVerifierAutoFill(TCS_BLOB);
    expect(input.stock_name).toBe('Tata Consultancy Services');
    expect(input.sector).toBe('it');
    expect(input.current_price).toBe(4000);
    expect(input.roe).toBe(45);
    expect(input.p1_promoter_pledge).toBe(0);
    expect(auto_keys.length).toBeGreaterThan(30);
    expect(auto_keys).toContain('stock_name');
    expect(auto_keys).toContain('roe');
    expect(auto_keys).not.toContain('thesis_business');
    expect(auto_keys).not.toContain('invalidation_1');
    expect(input.auto_prefilled).toBe('1');
  });

  it('phase 5 fills Piotroski, DCF IV, and Altman components', () => {
    const { input, auto_keys } = buildVerifierAutoFill(TCS_BLOB);
    expect(input.piotroski_score).toBeGreaterThanOrEqual(0);
    expect(input.dcf_iv).toBeGreaterThan(0);
    expect(auto_keys).toContain('piotroski_score');
    expect(auto_keys).toContain('dcf_iv');
    expect(auto_keys).toContain('alt_wc');
    expect(auto_keys).toContain('alt_total_assets');
    expect(input.z_score_source).toBe('unreliable');
    expect(input.altman_z).toBeUndefined();
  });

  it('maps metrics blob via metricsToVerifierBlob', () => {
    const blob = metricsToVerifierBlob(
      {
        symbol: 'TCS',
        name: 'TCS',
        price: 4000,
        eps: 120,
        book_value: 250,
        pe: 33,
        roe: 45,
        roce: 38,
        sector: 'IT',
        market_cap_cr: 1450000,
        debt_to_equity: 0.05,
        revenue_growth: 8,
        eps_growth: 12,
        div_yield: 1.5,
        fcf_cr: 35000,
        cfo_cr: 40000,
        high_52w: 4500,
        low_52w: 3200,
        ebitda_margin: 28,
        gross_margin: 42,
      },
      {
        revenue_history: [150000, 165000, 180000, 195000, 210000],
        pat_cr: 42000,
        promoter_pledge: 2.5,
        promoter_pledge_as_of: '2025-03-31',
      },
    );
    const input = mapToVerifierInput(blob);
    expect(input.p1_promoter_pledge).toBe(2.5);
    expect(input.pledge_data_as_of).toBe('2025-03-31');
    expect(input.revenue_latest).toBe(210000);
  });
});
