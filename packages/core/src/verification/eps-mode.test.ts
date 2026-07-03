import { describe, expect, it } from 'vitest';
import { runVerificationEngine } from '../verification-engine.js';
import { applyEpsModeToInput } from './sanitize.js';

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
  p0_emergency_fund: true,
  p0_debt_cleared: true,
};

describe('EPS mode — EpsModeHelper parity', () => {
  it('normalize defaults invalid to consolidated', () => {
    const applied = applyEpsModeToInput({ eps_mode: 'invalid', eps: 10, eps_consolidated: 10 });
    expect(applied.eps_mode).toBe('consolidated');
  });

  it('applyToInput sets standalone EPS and book value', () => {
    const applied = applyEpsModeToInput({
      ...DUAL_EPS_BASE,
      eps_mode: 'standalone',
    });
    expect(applied.eps).toBe(8);
    expect(applied.book_value_latest).toBe(40);
    expect(applied.pe_ratio).toBe(12.5);
  });

  it('standalone mode changes MOS vs consolidated', () => {
    const cons = runVerificationEngine({ ...DUAL_EPS_BASE, eps_mode: 'consolidated' });
    const stand = runVerificationEngine({ ...DUAL_EPS_BASE, eps_mode: 'standalone' });
    expect(stand.metrics.pe).toBe(12.5);
    expect(cons.metrics.pe).toBe(10);
    expect(stand.metrics.margin_of_safety).not.toBe(cons.metrics.margin_of_safety);
    expect(stand.metrics.eps_mode).toBe('standalone');
  });
});
