import { describe, expect, it } from 'vitest';
import { ACTION_BUY, ACTION_STRONG_BUY, ACTION_WATCH, enrichHit } from './auto-decision.js';
import {
  GRADE_FAIL,
  GRADE_STRONG,
  GRADE_UNPROVEN,
  compactFromStats,
} from './auto-backtest-truth.js';
import { serializeHit } from './auto-screener.js';

describe('auto-backtest-truth', () => {
  const strong = compactFromStats(
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

  const fail = compactFromStats(
    {
      trades_closed: 10,
      profit_factor: 0.7,
      win_rate_pct: 35,
      avg_win_pct: 3,
      avg_loss_pct: -4,
      compounded_return_pct: -12,
    },
    'XYZ',
  );

  const unproven = compactFromStats(
    {
      trades_closed: 2,
      profit_factor: 2,
      win_rate_pct: 100,
      avg_win_pct: 5,
      avg_loss_pct: 0,
      compounded_return_pct: 10,
    },
    'ABC',
  );

  it('grades strong / fail / unproven like PHP', () => {
    expect(strong.grade).toBe(GRADE_STRONG);
    expect(strong.score_delta).toBe(10);
    expect(fail.grade).toBe(GRADE_FAIL);
    expect(fail.risk_flag).toBe('BACKTEST_FAIL');
    expect(unproven.grade).toBe(GRADE_UNPROVEN);
  });

  it('raises decision score for BT strong and lowers for fail', () => {
    const baseHit = {
      symbol: 'TCS',
      verdict: 'SETUP',
      strict_verdict: 'ENTER',
      strict_enter_ready: true,
      entry_score: 88,
      swing_rank: 75,
      r_multiple_ok: true,
      ta_avg_value_cr: 30,
      ta_rsi14: 55,
      ta_pct_52w: 40,
    };
    const withStrong = enrichHit({ ...baseHit, backtest_truth: strong }, { bull: true });
    const plain = enrichHit(baseHit, { bull: true });
    expect(withStrong.decision_score).toBeGreaterThan(Number(plain.decision_score));
    expect(withStrong.risk_flags).toContain('BACKTEST_STRONG');

    const withFail = enrichHit({ ...baseHit, backtest_truth: fail }, { bull: true });
    expect(withFail.decision_score).toBeLessThan(Number(plain.decision_score));
    expect(withFail.high_conviction).toBe(false);
  });

  it('serializeHit exposes backtest columns', () => {
    const hit = enrichHit(
      {
        symbol: 'TCS',
        verdict: 'SETUP',
        strict_verdict: 'ENTER',
        price: 4000,
        stop_loss: 3800,
        swing_rank: 70,
        backtest_truth: strong,
      },
      { bull: true },
    );
    const serialized = serializeHit(hit);
    expect(serialized.backtest_grade).toBe(GRADE_STRONG);
    expect(serialized.backtest_pf).toBe(1.45);
    expect(serialized.backtest_trades).toBe(12);
  });

  it('FAIL grade downgrades action when score below 72', () => {
    const hit = enrichHit(
      {
        symbol: 'X',
        verdict: 'SETUP',
        strict_verdict: 'ENTER',
        swing_rank: 60,
        entry_score: 70,
        r_multiple_ok: true,
        backtest_truth: fail,
      },
      { bull: true },
    );
    expect(hit.decision_action).toBe(ACTION_WATCH);
  });

  it('WEAK grade skips when score below 62', () => {
    const hit = enrichHit(
      {
        symbol: 'X',
        verdict: 'SETUP',
        strict_verdict: 'SETUP',
        swing_rank: 50,
        entry_score: 55,
        backtest_truth: compactFromStats({
          trades_closed: 8,
          profit_factor: 0.95,
          win_rate_pct: 45,
          avg_win_pct: 3,
          avg_loss_pct: -3,
          compounded_return_pct: -2,
        }),
      },
      { bull: true },
    );
    expect(hit.decision_action).not.toBe(ACTION_STRONG_BUY);
    expect(hit.decision_action).not.toBe(ACTION_BUY);
  });
});
