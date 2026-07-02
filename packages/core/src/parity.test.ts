import { describe, expect, it } from 'vitest';
import {
  estimate,
  mosFromIntrinsic,
  grahamCredible,
  altmanSkip,
  altmanZone,
  normalizeSectorKey,
  moatTierRank,
  calculateFairPe,
  analyze as analyzeValuation,
} from './index.js';
describe('golden parity — validate-logic.php', () => {
  it('MOS formula: 125 IV, 100 price → 20%', () => {
    expect(mosFromIntrinsic(125, 100)).toBe(20);
  });

  it('normalizeSectorKey routes NBFC and oil/gas', () => {
    expect(normalizeSectorKey('nbfc finance')).toBe('nbfc');
    expect(normalizeSectorKey('oil exploration')).toBe('oil_gas');
    expect(normalizeSectorKey('life insurance')).toBe('insurance');
  });

  it('TCS-like estimate matches PHP MosHelper::estimate', () => {
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

    expect(est.graham_credible).toBe(false);
    expect(est.graham).toBeGreaterThan(0);
    expect(est.altman_zone).toBe('safe');
    expect(est.mos).toBeCloseTo(17.2, 0);
    expect(est.intrinsic).toBeCloseTo(2175.13, 0);
    expect(est.fair_pe).toBeCloseTo(22.4, 0);
    expect(est.method).toContain('DCF');
  });

  it('banking uses P/B model', () => {
    const bank = analyzeValuation({
      symbol: 'HDFCBANK',
      price: 1000,
      book_value: 400,
      roe: 16,
      roce: 14,
      sector: 'banking',
      market_cap_cr: 500000,
    });
    expect(bank.valuation_model).toBe('pb');
    expect(bank.intrinsic).toBeCloseTo(464, 0);
    expect(bank.mos).toBeCloseTo(-115.5, 0);
  });

  it('ONGC-like Graham floor when use_graham_floor set', () => {
    const ongc = analyzeValuation({
      symbol: 'ONGC',
      sector: 'oil_gas',
      price: 100,
      eps: 25,
      book_value: 180,
      use_graham_floor: true,
      roce: 12,
      roe: 14,
      market_cap_cr: 300000,
      ebitda_margin: 8,
      total_debt_cr: 80000,
      profit_yoy: 8,
      sales_yoy: 6,
      revenue_growth_3yr: 7,
    });
    expect(ongc.graham_credible).toBe(true);
    expect(ongc.valuation_flags).toContain('graham_floor_active');
    expect(ongc.intrinsic).toBeCloseTo(270.47, 0);
  });

  it('Graham/Altman placement', () => {
    const tcsCtx = {
      normalized_eps: 135,
      book_value: 296,
      price: 1800,
      pb_ratio: 6.08,
      sector: 'it',
      market_cap_cr: 800000,
      profit_yoy: 12,
      sales_yoy: 9,
      revenue_growth_3yr: 5.8,
    };
    expect(grahamCredible('it', tcsCtx)).toBe(false);

    const ongcCtx = {
      normalized_eps: 25,
      book_value: 180,
      price: 250,
      pb_ratio: 1.39,
      sector: 'oil_gas',
      market_cap_cr: 300000,
      profit_yoy: 8,
      sales_yoy: 6,
      revenue_growth_3yr: 7,
    };
    expect(grahamCredible('oil_gas', ongcCtx)).toBe(true);
    expect(altmanSkip('banking')).toBe(true);
    expect(altmanZone(3.2)).toBe('safe');
    expect(altmanZone(1.5)).toBe('distress');
  });

  it('moat tier ranks', () => {
    expect(moatTierRank('weak')).toBe(0);
    expect(moatTierRank('moderate')).toBe(1);
    expect(moatTierRank('strong')).toBe(2);
    expect(moatTierRank('exceptional')).toBe(3);
  });

  it('industry median P/E', () => {
    expect(calculateFairPe(10, { sector: 'IT', roe: 20, roce: 18 }).fair_pe).toBeGreaterThan(14);
  });
});
