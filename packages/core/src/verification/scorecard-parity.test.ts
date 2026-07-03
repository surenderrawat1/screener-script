import { describe, expect, it } from 'vitest';
import { runVerificationEngine } from '../verification-engine.js';

/** PHP validate-logic.php testEpsModeToggle base fixture */
const DUAL_EPS_BASE: Record<string, string | number | boolean> = {
  stock_name: 'Dual EPS Co',
  sector: 'general',
  current_price: 100,
  eps: 10,
  eps_consolidated: 10,
  eps_standalone: 8,
  book_value_latest: 50,
  book_value_consolidated: 50,
  book_value_standalone: 40,
  pe_ratio: 10,
  eps_growth: 12,
  revenue_growth_3yr: 10,
  roe: 18,
  roce: 16,
  debt_to_equity: 0.3,
  market_cap_cr: 5000,
  fcf: 100,
  cfo: 120,
  pat_latest: 200,
  piotroski_score: 7,
  altman_z: 3.5,
  z_score_source: 'estimated',
  eps_mode: 'consolidated',
};

const CACHE_META = { created_at: Math.floor(Date.now() / 1000) };

describe('scorecard parity — validate-logic.php engine fixtures', () => {
  it('Dual EPS consolidated scorecard within ±2 of PHP baseline (29)', () => {
    const result = runVerificationEngine(DUAL_EPS_BASE, { cacheMeta: CACHE_META });
    expect(result.scorecard.max).toBe(56);
    expect(result.scorecard.total).toBeGreaterThanOrEqual(27);
    expect(result.scorecard.total).toBeLessThanOrEqual(31);
  });

  it('Dual EPS standalone P/E = price / standalone EPS (PHP: 12.5)', () => {
    const result = runVerificationEngine(
      { ...DUAL_EPS_BASE, eps_mode: 'standalone' },
      { cacheMeta: CACHE_META },
    );
    expect(result.metrics.pe).toBeCloseTo(12.5, 1);
    expect(result.metrics.margin_of_safety).not.toBe(
      runVerificationEngine(DUAL_EPS_BASE, { cacheMeta: CACHE_META }).metrics.margin_of_safety,
    );
  });

  it('TCS-like autofill + manual Phase 0/1 scorecard within ±2 of v2 baseline (39)', () => {
    const input: Record<string, string | number | boolean> = {
      stock_name: 'Tata Consultancy Services',
      fetch_symbol: 'TCS',
      sector: 'it',
      current_price: 1800,
      eps: 135,
      book_value_latest: 296,
      pe_ratio: 33,
      roe: 45,
      roce: 38,
      debt_to_equity: 0.05,
      revenue_growth: 8,
      revenue_growth_3yr: 10,
      eps_growth: 12,
      market_cap_cr: 1450000,
      fcf: 35000,
      cfo: 42000,
      pat_latest: 42000,
      revenue_latest: 210000,
      piotroski_score: 7,
      altman_z: 3.5,
      z_score_source: 'estimated',
      eps_mode: 'consolidated',
      dcf_iv: 2400,
      p1_promoter_pledge: 0,
      p1_industry_outlook: 'growing',
      p2_revenue_growing: 'yes',
      p2_pat_quality: 'yes',
      p2_fcf_positive: 'yes',
      p2_margins_ok: 'yes',
      p2_de_ok: 'yes',
      p2_bv_growing: 'yes',
      p2_wc_ok: 'yes',
      p2_cfo_pat: 'yes',
      p2_fcf_dividend: 'yes',
      p2_chairman_honest: '1',
      p2_auditor_clean: '1',
      p2_contingent_ok: '1',
      p2_accounting_ok: '1',
      roe_3yr_above_15: 'yes',
      roce_near_roe: 'yes',
      roe_from_operations: 'yes',
      p4_revenue_cagr: 'no',
      p4_eps_growth_pace: 'yes',
      p4_peg_ok: 'no',
      p5_fscore_ok: 'yes',
      p5_zscore_ok: 'yes',
      p5_dcf_sanity: 'yes',
      it_rev_growth: 8,
      p6_kpi_identified: 'yes',
      p0_emergency_fund: true,
      p0_debt_cleared: true,
      p0_sip_habit: true,
      p0_asset_allocation: true,
      p0_emotional_discipline: true,
      p1_business_model: 'yes',
      p1_revenue_model: 'yes',
      p1_circle_competence: 'yes',
      manual_attestation: true,
    };
    const result = runVerificationEngine(input, {
      sectorHints: { TCS: 'it' },
      cacheMeta: CACHE_META,
    });
    expect(result.scorecard.total).toBeGreaterThanOrEqual(40);
    expect(result.scorecard.total).toBeLessThanOrEqual(44);
    expect(result.phases).toHaveLength(9);
  });
});
