import { describe, expect, it } from 'vitest';
import { MOMENTUM_STRONG } from './dynamic-signals.js';
import { computeTradePlan } from './evaluate-entry.js';
import { rankHits, scoreHit, tier } from './ranker.js';
import type { SwingScanHit } from './types.js';

/** PHP golden: KIMS top hit @ 817.15 EOD 2026-07-07 (Nifty 500 SETUP+ scan). */
const KIMS_PRICE = 817.15;
const KIMS_SMA50 = 805;
const KIMS_EMA21 = 800;
const KIMS_ATR_PCT = 2;

const kimsDynamic = {
  momentum: MOMENTUM_STRONG,
  volume_surge: false,
  golden_cross_active: true,
  gc9_active: true,
  entry_ok: true,
};

function kimsHit(overrides: Partial<SwingScanHit> = {}): SwingScanHit {
  return {
    symbol: 'KIMS',
    price: KIMS_PRICE,
    verdict: 'ENTER',
    strict_verdict: 'ENTER',
    entry_score: 94,
    rules_passed: 10,
    stop_loss: 794.68,
    profit_target: 892.65,
    r_multiple: 3.36,
    r_multiple_ok: true,
    ta_avg_value_cr: 12,
    regime_key: 'bear',
    ...overrides,
  };
}

describe('parity — KIMS universe scan row', () => {
  it('computeTradePlan matches PHP stop, boosted target, and R', () => {
    const plan = computeTradePlan(KIMS_PRICE, KIMS_SMA50, KIMS_EMA21, KIMS_ATR_PCT, kimsDynamic);
    expect(plan.effective_stop).toBeCloseTo(794.68, 2);
    expect(plan.profit_target).toBeCloseTo(892.65, 1);
    expect(plan.r_multiple).toBeCloseTo(3.36, 2);
    expect(plan.r_multiple_ok).toBe(true);
  });

  it('tier A from entry score 94', () => {
    expect(tier(94)).toBe('A');
  });

  it('swing_rank 92 in bear regime (PHP rank column)', () => {
    expect(scoreHit(kimsHit())).toBe(92);
    const [ranked] = rankHits([kimsHit()]);
    expect(ranked.swing_rank).toBe(92);
    expect(ranked.swing_tier).toBe('A');
  });
});
