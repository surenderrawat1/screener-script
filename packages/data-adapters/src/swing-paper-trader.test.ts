import { describe, expect, it } from 'vitest';
import {
  swingPaperCandidateReasons,
  swingPaperSoftFlags,
} from './swing-paper-trader.js';

function eligibleHit(overrides: Record<string, unknown> = {}) {
  return {
    symbol: 'TCS',
    high_conviction: true,
    strict_verdict: 'ENTER',
    strict_enter_ready: true,
    r_multiple: 3.2,
    r_multiple_ok: true,
    net_edge_ok: true,
    decision_action: 'BUY',
    incremental_stale: false,
    backtest_truth: {
      trades_closed: 20,
      win_rate_pct: 75,
      profit_factor: 1.8,
      expectancy_pct: 2.1,
      compounded_return_pct: 15,
      max_drawdown_pct: 8,
      grade: 'STRONG',
    },
    ...overrides,
  };
}

describe('Swing Auto paper entry policy', () => {
  it('allows fresh High Conviction Strict ENTER with ≥10 BT trades', () => {
    expect(swingPaperCandidateReasons(eligibleHit())).toEqual([]);
    expect(swingPaperSoftFlags(eligibleHit())).toEqual([]);
  });

  it('requires High Conviction', () => {
    expect(swingPaperCandidateReasons(eligibleHit({ high_conviction: false }))).toContain(
      'not High Conviction',
    );
  });

  it('blocks compounder sleeve from Swing paper', () => {
    expect(
      swingPaperCandidateReasons(
        eligibleHit({
          sleeve: 'compounder',
          sleeve_blocks_swing_paper: true,
          high_conviction: true,
        }),
      ),
    ).toContain('compounder sleeve — use positional moat book, not Swing paper');
  });

  it('requires Strict ENTER', () => {
    expect(
      swingPaperCandidateReasons(eligibleHit({ strict_verdict: 'SETUP', high_conviction: true })),
    ).toContain('strict verdict is not ENTER');
  });

  it('hard-blocks missing 3R geometry', () => {
    const hit = eligibleHit({ r_multiple_ok: false, r_multiple: 2.1 });
    expect(swingPaperCandidateReasons(hit)).toContain('R multiple is below minimum');
  });

  it('soft-allows WR below 70% — does not hard-block when edge passes', () => {
    const hit = eligibleHit({
      backtest_truth: {
        trades_closed: 20,
        win_rate_pct: 55,
        profit_factor: 1.8,
        expectancy_pct: 1.5,
        compounded_return_pct: 12,
        max_drawdown_pct: 8,
        avg_win_pct: 8,
        avg_loss_pct: -4,
      },
    });
    expect(swingPaperCandidateReasons(hit)).toEqual([]);
    expect(swingPaperSoftFlags(hit).some((f) => /70%/.test(f))).toBe(true);
  });

  it('hard-blocks failed economic edge even when WR is high', () => {
    expect(
      swingPaperCandidateReasons(
        eligibleHit({
          backtest_truth: {
            trades_closed: 20,
            win_rate_pct: 80,
            profit_factor: 0.9,
            expectancy_pct: -0.5,
            compounded_return_pct: -5,
            max_drawdown_pct: 25,
            avg_win_pct: 3,
            avg_loss_pct: -5,
          },
        }),
      ),
    ).not.toEqual([]);
  });

  it('blocks inadequate BT sample (<10 trades)', () => {
    expect(
      swingPaperCandidateReasons(
        eligibleHit({
          backtest_truth: {
            trades_closed: 5,
            win_rate_pct: 80,
            profit_factor: 2,
            expectancy_pct: 3,
          },
        }),
      ),
    ).toContain('Backtest sample below 10 trades');
  });

  it('blocks stale carried hits', () => {
    expect(swingPaperCandidateReasons(eligibleHit({ incremental_stale: true }))).toContain(
      'stale carried data',
    );
  });
});
