import { describe, expect, it } from 'vitest';
import {
  evaluateCompounderSleeve,
  evaluateCompounderHold,
  COMPOUNDER_MIN_BUY_HOLD_PCT,
  COMPOUNDER_MIN_HOLD_SESSIONS,
  COMPOUNDER_NOTES_MARKER,
} from './compounder-sleeve.js';

describe('compounder sleeve', () => {
  it('routes quality + failed swing edge + strong buy-hold to compounder', () => {
    const r = evaluateCompounderSleeve({
      fundamental_quality_ok: true,
      backtest_truth: {
        grade: 'FAIL',
        economic_edge_status: 'fail',
        trades_closed: 20,
        profit_factor: 0.6,
        compounded_return_pct: -10,
        max_drawdown_pct: 30,
        expectancy_pct: -0.5,
        buy_hold_pct: 120,
      },
    });
    expect(r.sleeve).toBe('compounder');
    expect(r.eligible).toBe(true);
    expect(r.blocks_swing_paper).toBe(true);
    expect(r.summary).toContain('buy&hold');
    expect(COMPOUNDER_MIN_BUY_HOLD_PCT).toBe(25);
  });

  it('keeps swing sleeve when economic edge passes', () => {
    const r = evaluateCompounderSleeve({
      fundamental_quality_ok: true,
      high_conviction: true,
      backtest_truth: {
        grade: 'OK',
        economic_edge_status: 'pass',
        trades_closed: 15,
        profit_factor: 1.5,
        compounded_return_pct: 12,
        max_drawdown_pct: 10,
        expectancy_pct: 0.8,
        buy_hold_pct: 40,
      },
    });
    expect(r.sleeve).toBe('swing');
    expect(r.eligible).toBe(false);
  });

  it('avoids names that fail quality', () => {
    const r = evaluateCompounderSleeve({
      fundamental_quality_ok: false,
      fundamental_quality_summary: 'ROE low',
      backtest_truth: { grade: 'FAIL', economic_edge_status: 'fail', buy_hold_pct: 200 },
    });
    expect(r.sleeve).toBe('avoid');
  });

  it('forces min-hold and ignores swing trim window', () => {
    const hold = evaluateCompounderHold({
      sessions_held: 20,
      gain_pct: 12,
      fundamental_quality_ok: true,
      notes: COMPOUNDER_NOTES_MARKER,
    });
    expect(hold.action).toBe('HOLD');
    expect(hold.sessions_held).toBe(20);
    expect(hold.min_hold_sessions).toBe(COMPOUNDER_MIN_HOLD_SESSIONS);
    expect(hold.ignore_swing_target).toBe(true);
    expect(hold.summary).toMatch(/min-hold/i);
  });

  it('exits when quality floor breaks', () => {
    const hold = evaluateCompounderHold(
      { sessions_held: 80, gain_pct: 5 },
      { fundamental_quality_ok: false, fundamental_quality_summary: 'ROE/ROCE below floor' },
    );
    expect(hold.action).toBe('EXIT_THESIS');
  });

  it('reviews on deep peak drawdown', () => {
    const hold = evaluateCompounderHold({
      sessions_held: 90,
      gain_pct: -5,
      high_water: 200,
      current_price: 120,
      fundamental_quality_ok: true,
    });
    expect(hold.action).toBe('REVIEW_THESIS');
    expect(hold.peak_dd_pct).toBeGreaterThanOrEqual(35);
  });
});
