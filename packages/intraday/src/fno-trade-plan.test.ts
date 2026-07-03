import { describe, expect, it } from 'vitest';
import { atmStrike, fnoSpecForInstrument, nextWeeklyExpiry } from './fno-specs.js';
import { buildFnoTradePlans } from './fno-trade-plan.js';

const longPlan = {
  ok: true,
  bias: 'long',
  entry: { type: 'market', price: 24500 },
  stop_loss: { price: 24400, pts: 100 },
  exits: [
    { tier: 'T1', price: 24600, rr: 1 },
    { tier: 'T2', price: 24700, rr: 2 },
    { tier: 'T3', price: 24800, rr: 3 },
  ],
  trigger: { actionable: true, status: 'READY' },
  time_stop_ist: '15:15',
};

describe('fno-specs', () => {
  it('rounds ATM strike to 50 for Nifty', () => {
    expect(atmStrike(24523, 50)).toBe(24500);
    expect(fnoSpecForInstrument('nifty50').lot_size).toBe(75);
  });

  it('returns weekly expiry label', () => {
    const exp = nextWeeklyExpiry(fnoSpecForInstrument('nifty50'), new Date('2026-07-02T10:00:00+05:30'));
    expect(exp.label).toMatch(/\d{2} \w{3} \d{4}/);
  });
});

describe('buildFnoTradePlans', () => {
  it('builds futures and options for long spot plan', () => {
    const out = buildFnoTradePlans(
      'nifty50',
      longPlan,
      { price: 24500, confidence: 60 },
      { deploy_pct: 70 },
    );
    expect(out.ok).toBe(true);
    expect(out.futures?.side).toBe('BUY');
    expect(out.futures?.lot_size).toBe(75);
    expect(out.options?.option_type).toBe('CE');
    expect(out.options?.strike).toBeGreaterThan(0);
  });

  it('stands aside when spot plan blocked', () => {
    const out = buildFnoTradePlans('nifty50', { ok: false, message: 'Wait' }, { price: 24500 }, null);
    expect(out.ok).toBe(false);
    expect(out.futures).toBeNull();
  });

  it('maps short bias to PE and sell futures', () => {
    const shortPlan = { ...longPlan, bias: 'short', entry: { price: 24500 }, stop_loss: { price: 24600 } };
    const out = buildFnoTradePlans(
      'nifty50',
      shortPlan,
      { price: 24500, confidence: 55 },
      { deploy_pct: 55 },
    );
    expect(out.futures?.side).toBe('SELL');
    expect(out.options?.option_type).toBe('PE');
  });
});
