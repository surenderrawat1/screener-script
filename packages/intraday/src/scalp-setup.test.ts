import { describe, expect, it } from 'vitest';
import { applyScalpExitProfile, buildScalpSetup, SCALP_PRESET_ID } from './scalp-setup.js';

const basePlan = {
  ok: true,
  bias: 'long',
  bias_label: 'Long bias',
  interval: '5m',
  entry: { type: 'market', price: 24000, condition: 'Test' },
  stop_loss: { price: 23920, pts: 80, pct: 0.33 },
  exits: [
    { tier: 'T1', price: 24080, rr: 1, action: 'Book 40%' },
    { tier: 'T2', price: 24160, rr: 2, action: 'Book 40%' },
    { tier: 'T3', price: 24240, rr: 3, action: 'Book 20%' },
  ],
  trigger: { status: 'READY', label: 'Ready', actionable: true },
};

const analysis5 = {
  ok: true,
  direction: 'bullish',
  direction_label: 'Bullish',
  confidence: 55,
  bar_minutes_ist: 11 * 60 + 30,
  trade_plan: basePlan,
  session_regime: { key: 'trend_down', label: 'Trend down' },
  entry_window: { open: true, label: 'Open' },
};

const analysis15 = { ok: true, trade_plan: basePlan };
const mtf = { ok: true, aligned: true, conflict: false, deploy_pct: 70 };

describe('scalp-setup', () => {
  it('applies quick_scalp exits at 0.8 / 1.5 / 2.2R', () => {
    const applied = applyScalpExitProfile(basePlan, 'quick_scalp');
    expect(applied.exit_profile).toBe('quick_scalp');
    const exits = applied.exits as Array<{ rr: number; price: number }>;
    expect(exits).toHaveLength(3);
    expect(exits[0].rr).toBe(0.8);
    expect(exits[0].price).toBe(24064);
  });

  it('builds a 5m scalp plan from directional analysis', () => {
    const setup = buildScalpSetup(analysis5, analysis15, mtf, { id: 'nifty50' });
    expect((setup.plan as Record<string, unknown> | null)?.ok).toBe(true);
    expect(setup.preset_id).toBe(SCALP_PRESET_ID);
    expect(setup.exit_profile).toBe('quick_scalp');
    expect(setup.source).toBe('nifty_scalp_5m');
  });

  it('blocks range bias from scalp entry', () => {
    const rangePlan = { ...basePlan, bias: 'range' };
    const blocked = buildScalpSetup(
      { ...analysis5, trade_plan: rangePlan },
      analysis15,
      mtf,
      { id: 'nifty50' },
    );
    expect(blocked.entry_allowed).toBe(false);
    expect(blocked.ok).toBe(false);
    expect(blocked.plan).toBeNull();
  });
});
