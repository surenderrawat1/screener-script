import { describe, expect, it } from 'vitest';
import {
  intradayAccuracyStatus,
  meetsIntradayAccuracy,
  MIN_INTRADAY_ACCURACY_PCT,
  MIN_INTRADAY_TRADES_PROVEN,
} from './intraday-backtest.js';
import { build } from './live-playbook.js';
import { TIME_STOP_IST } from './session-clock.js';

const plan = {
  ok: true,
  bias: 'long',
  bias_label: 'Long bias',
  time_stop_ist: TIME_STOP_IST,
  entry: { type: 'market', price: 100, condition: 'Test entry' },
  stop_loss: { price: 99, pts: 1, pct: 1, label: 'Stop' },
  exits: [{ tier: 'T1', price: 101, rr: 1, action: 'Book 40%' }],
  trigger: { status: 'READY', label: 'Ready', distance_pts: 0, actionable: true },
};

const analysis = {
  ok: true,
  price: 100.5,
  interval: '15m',
  direction: 'bullish',
  confidence: 62,
  net_score: 30,
  bar_minutes_ist: 11 * 60,
  setup_quality: { grade: 'A', score: 72 },
  session_regime: { key: 'lean_up', label: 'Mild up' },
  ema_stack_bull: true,
};

const analysis5 = {
  ok: true,
  price: 100.5,
  ema50: 99,
  ema50_bias: { bias: 'long', label: '5m above EMA-50', ok: true },
  gc9_dc9_bias: { bias: 'long', label: 'GC9', ok: true },
  sma9: 101,
  sma50: 100,
  gc9_active: true,
};

const mtf = { ok: true, aligned: true, deploy_pct: 80, conflict: false };
const presetEval = [
  { id: 'cfa_precision', label: 'CFA precision', pass_15m: true, reasons_15m: [] },
];

describe('intraday >70% high-accuracy gate', () => {
  it('uses a strict >70% floor and 10-trade minimum', () => {
    expect(MIN_INTRADAY_ACCURACY_PCT).toBe(70);
    expect(MIN_INTRADAY_TRADES_PROVEN).toBe(10);
    expect(intradayAccuracyStatus({ trades: 10, win_rate_pct: 70 })).toBe('fail');
    expect(intradayAccuracyStatus({ trades: 10, win_rate_pct: 70.1 })).toBe('pass');
    expect(meetsIntradayAccuracy({ trades: 15, win_rate_pct: 72 })).toBe(true);
  });

  it('does not treat a small 100% sample as proven', () => {
    expect(intradayAccuracyStatus({ trades: 9, win_rate_pct: 100 })).toBe('unproven');
    expect(meetsIntradayAccuracy({ trades: 9, win_rate_pct: 100 })).toBe(false);
  });

  it('marks missing evidence as missing', () => {
    expect(intradayAccuracyStatus(null)).toBe('missing');
    expect(intradayAccuracyStatus({ trades: 0, win_rate_pct: null })).toBe('missing');
  });

  it('blocks live playbook when proven win rate is not above 70%', () => {
    const playbook = build(
      plan,
      analysis,
      analysis5,
      mtf,
      presetEval,
      'cfa_precision',
      '15m',
      {
        trades: 20,
        win_rate_pct: 65,
        accuracy_status: 'fail',
        accuracy_pass: false,
        accuracy_floor_pct: 70,
      },
    );
    expect(playbook.actionable).toBe(false);
    expect(String(playbook.headline)).toContain('WAIT');
    expect(
      (playbook.steps[0].details as string[]).some((line) => line.includes('65%')),
    ).toBe(true);
  });

  it('allows live playbook when proven win rate is above 70%', () => {
    const playbook = build(
      plan,
      analysis,
      analysis5,
      mtf,
      presetEval,
      'cfa_precision',
      '15m',
      {
        trades: 20,
        win_rate_pct: 75,
        accuracy_status: 'pass',
        accuracy_pass: true,
        accuracy_floor_pct: 70,
      },
    );
    expect(playbook.actionable).toBe(true);
    expect(String(playbook.headline)).toContain('GO');
  });
});
