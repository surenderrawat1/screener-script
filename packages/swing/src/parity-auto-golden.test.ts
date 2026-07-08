import { describe, expect, it } from 'vitest';
import { ACTION_STRONG_BUY, enrichHit } from './auto-decision.js';
import { compactFromStats, GRADE_STRONG } from './auto-backtest-truth.js';
import { serializeHit } from './auto-screener.js';

/** Frozen TCS-like top hit — regression guard for auto radar serialization. */
const GOLDEN_BT = compactFromStats(
  {
    trades_closed: 12,
    profit_factor: 1.45,
    win_rate_pct: 58,
    avg_win_pct: 4.2,
    avg_loss_pct: -2.1,
    compounded_return_pct: 18.5,
    max_drawdown_pct: 6,
  },
  'TCS',
);

const GOLDEN_RAW = {
  symbol: 'TCS',
  verdict: 'SETUP',
  strict_verdict: 'ENTER',
  strict_enter_ready: true,
  entry_score: 88,
  swing_rank: 78,
  price: 4000,
  stop_loss: 3800,
  profit_target: 4400,
  r_multiple: 2,
  r_multiple_ok: true,
  ta_avg_value_cr: 30,
  volume_surge: true,
  ta_rsi14: 55,
  ta_pct_52w: 45,
  ta_52w_chart_zone: 'green',
  as_of_date: '2026-07-07',
  backtest_truth: GOLDEN_BT,
};

const BULL_REGIME = { bull: true, label: 'Bull', proxy: 'NIFTYBEES', key: 'bull' };

describe('parity-auto-golden', () => {
  it('enrichHit + serializeHit match frozen top-hit contract', () => {
    const enriched = enrichHit(GOLDEN_RAW, BULL_REGIME);
    const row = serializeHit(enriched);

    expect(enriched.high_conviction).toBe(true);
    expect(enriched.decision_action).toBe(ACTION_STRONG_BUY);
    expect(enriched.decision_score).toBeGreaterThanOrEqual(70);

    expect(row.symbol).toBe('TCS');
    expect(row.entry_score).toBe(88);
    expect(row.swing_rank).toBe(78);
    expect(row.tier).toBe('A');
    expect(row.strict).toBe('ENTER');
    expect(row.backtest_grade).toBe(GRADE_STRONG);
    expect(row.backtest_pf).toBe(1.45);
    expect(row.backtest_trades).toBe(12);
    expect(row.ta_52w_chart_zone).toBe('green');
    expect(row.as_of_date).toBe('2026-07-07');
    expect(row.suggested_shares).toBeGreaterThan(0);
    expect(row.add_allowed).toBe(true);
    expect(row.already_held).toBe(false);
  });

  it('serializeHit preserves held overlay fields', () => {
    const held = enrichHit(
      { ...GOLDEN_RAW, already_held: true, add_allowed: false, held_near_stop: true, held_action_label: 'Tighten stop', held_stop_distance_pct: 1.2 },
      BULL_REGIME,
    );
    const row = serializeHit(held);
    expect(row.already_held).toBe(true);
    expect(row.held_near_stop).toBe(true);
    expect(row.held_action_label).toBe('Tighten stop');
    expect(row.held_stop_distance_pct).toBe(1.2);
    expect(row.add_allowed).toBe(false);
  });
});
