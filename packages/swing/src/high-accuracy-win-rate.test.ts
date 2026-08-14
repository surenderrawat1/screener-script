import { describe, expect, it } from 'vitest';
import { enrichHit } from './auto-decision.js';
import {
  GRADE_OK,
  GRADE_STRONG,
  GRADE_WEAK,
  MIN_PROFITABLE_WIN_RATE_PCT,
  compactFromStats,
  economicEdgeGateStatus,
  meetsEconomicEdge,
  meetsHighAccuracyWinRate,
  statsFromWalkForwardSignals,
  winRateGateStatus,
} from './auto-backtest-truth.js';
import { checkAddPosition, liveAddGateReasons, serializeHit } from './auto-screener.js';

describe('economic-edge primary gate (WR soft)', () => {
  it('keeps soft WR floor export for diagnostics', () => {
    expect(MIN_PROFITABLE_WIN_RATE_PCT).toBe(70);
  });

  it('statsFromWalkForwardSignals computes win rate from profitable forwards', () => {
    const signals = [
      ...Array.from({ length: 8 }, () => ({ forward_return_pct: 3.5 })),
      ...Array.from({ length: 2 }, () => ({ forward_return_pct: -2.0 })),
    ];
    const stats = statsFromWalkForwardSignals(signals);
    expect(stats.trades_closed).toBe(10);
    expect(stats.win_rate_pct).toBe(80);
    expect(meetsHighAccuracyWinRate(stats)).toBe(true);
    expect(winRateGateStatus(stats)).toBe('pass');
  });

  it('soft WR fail does not imply economic-edge fail when expectancy/PF/DD clear', () => {
    // Low WR but fat winners → positive expectancy and strong PF.
    const edgeOkLowWr = compactFromStats({
      trades_closed: 12,
      profit_factor: 1.8,
      win_rate_pct: 45,
      avg_win_pct: 8,
      avg_loss_pct: -2,
      compounded_return_pct: 22,
      max_drawdown_pct: 8,
    });
    expect(winRateGateStatus(edgeOkLowWr)).toBe('fail');
    expect(meetsHighAccuracyWinRate(edgeOkLowWr)).toBe(false);
    expect(economicEdgeGateStatus(edgeOkLowWr)).toBe('pass');
    expect(meetsEconomicEdge(edgeOkLowWr)).toBe(true);
    expect(edgeOkLowWr.grade).toBe(GRADE_STRONG);
  });

  it('economic edge fails on weak PF / negative expectancy even at high WR', () => {
    const highWrNoEdge = compactFromStats({
      trades_closed: 12,
      profit_factor: 0.9,
      win_rate_pct: 75,
      avg_win_pct: 1.2,
      avg_loss_pct: -4,
      compounded_return_pct: -3,
      max_drawdown_pct: 12,
    });
    expect(winRateGateStatus(highWrNoEdge)).toBe('pass');
    expect(economicEdgeGateStatus(highWrNoEdge)).toBe('fail');
    expect(highWrNoEdge.grade).toBe(GRADE_WEAK);
  });

  it('STRONG grade does not require ≥70% WR', () => {
    const lowWrStrongEdge = compactFromStats({
      trades_closed: 12,
      profit_factor: 1.45,
      win_rate_pct: 58,
      avg_win_pct: 4.2,
      avg_loss_pct: -2.1,
      compounded_return_pct: 18.5,
      max_drawdown_pct: 6,
    });
    expect(lowWrStrongEdge.grade).toBe(GRADE_STRONG);
    expect(lowWrStrongEdge.win_rate_ok).toBe(false);
    expect(lowWrStrongEdge.economic_edge_ok).toBe(true);

    const highWr = compactFromStats({
      trades_closed: 12,
      profit_factor: 1.45,
      win_rate_pct: 72,
      avg_win_pct: 4.2,
      avg_loss_pct: -2.1,
      compounded_return_pct: 18.5,
      max_drawdown_pct: 6,
    });
    expect(highWr.grade).toBe(GRADE_STRONG);
    expect(highWr.win_rate_ok).toBe(true);
  });

  it('unproven sample (<5 trades) does not pass even at 100% WR', () => {
    const stats = statsFromWalkForwardSignals([
      { forward_return_pct: 5 },
      { forward_return_pct: 3 },
    ]);
    expect(stats.win_rate_pct).toBe(100);
    expect(winRateGateStatus(stats)).toBe('unproven');
    expect(economicEdgeGateStatus(stats)).toBe('unproven');
    expect(meetsHighAccuracyWinRate(stats)).toBe(false);
    expect(meetsEconomicEdge(stats)).toBe(false);
  });

  it('high conviction blocked when economic edge fails (even if WR ≥ 70%)', () => {
    const noEdge = compactFromStats({
      trades_closed: 12,
      profit_factor: 1.05,
      win_rate_pct: 72,
      avg_win_pct: 2,
      avg_loss_pct: -3.5,
      compounded_return_pct: 1,
      max_drawdown_pct: 22,
    });
    const hit = enrichHit(
      {
        symbol: 'NOEDGE',
        verdict: 'SETUP',
        strict_verdict: 'ENTER',
        strict_enter_ready: true,
        entry_score: 92,
        swing_rank: 80,
        r_multiple_ok: true,
        net_edge_ok: true,
        ta_avg_value_cr: 30,
        ta_rsi14: 55,
        ta_pct_52w: 45,
        backtest_truth: noEdge,
      },
      { bull: true },
    );
    expect(hit.risk_flags).toContain('BACKTEST_EDGE_FAIL');
    expect(hit.high_conviction).toBe(false);
  });

  it('high conviction allowed when economic edge passes even if WR < 70%', () => {
    const edgeOk = compactFromStats({
      trades_closed: 12,
      profit_factor: 1.8,
      win_rate_pct: 48,
      avg_win_pct: 7,
      avg_loss_pct: -2,
      compounded_return_pct: 20,
      max_drawdown_pct: 7,
    });
    const hit = enrichHit(
      {
        symbol: 'EDGEOK',
        verdict: 'SETUP',
        strict_verdict: 'ENTER',
        strict_enter_ready: true,
        entry_score: 92,
        swing_rank: 80,
        r_multiple_ok: true,
        net_edge_ok: true,
        ta_avg_value_cr: 30,
        volume_surge: true,
        broke_swing_high: true,
        ta_rsi14: 55,
        ta_pct_52w: 45,
        backtest_truth: edgeOk,
      },
      { bull: true },
    );
    expect(hit.risk_flags).toContain('BACKTEST_LOW_WR');
    expect(hit.risk_flags).toContain('BACKTEST_EDGE_OK');
    expect(hit.high_conviction).toBe(true);
    const row = serializeHit(hit, { bull: true });
    expect(row.backtest_economic_edge_ok).toBe(true);
    expect(row.backtest_win_rate_ok).toBe(false);
    expect(row.add_allowed).toBe(true);
  });

  it('live Add blocked on economic edge fail — not WR alone', () => {
    const noEdge = compactFromStats({
      trades_closed: 10,
      profit_factor: 1.05,
      win_rate_pct: 75,
      avg_win_pct: 1.5,
      avg_loss_pct: -3,
      compounded_return_pct: -1,
      max_drawdown_pct: 10,
    });
    const reasons = liveAddGateReasons({
      strict_verdict: 'ENTER',
      strict_enter_ready: true,
      r_multiple_ok: true,
      net_edge_ok: true,
      decision_action: 'BUY',
      backtest_truth: noEdge,
    });
    expect(reasons.some((r) => /expectancy|profit factor|compounded|drawdown|economic/i.test(r))).toBe(
      true,
    );
    expect(reasons.some((r) => /70%/.test(r))).toBe(false);

    const blocked = checkAddPosition(
      {
        symbol: 'NOEDGE',
        entry_price: 100,
        stop_loss: 95,
        strict_verdict: 'ENTER',
        strict_enter_ready: true,
        r_multiple_ok: true,
        net_edge_ok: true,
        decision_action: 'BUY',
        backtest_truth: noEdge,
      },
      [],
      { bull: true },
    );
    expect(blocked.ok).toBe(false);
    expect(String(blocked.error)).not.toMatch(/70%/);
  });

  it('OK grade when edge is positive but not STRONG thresholds', () => {
    const ok = compactFromStats({
      trades_closed: 6,
      profit_factor: 1.1,
      win_rate_pct: 55,
      avg_win_pct: 3,
      avg_loss_pct: -2,
      compounded_return_pct: 2,
      max_drawdown_pct: 12,
    });
    expect(ok.grade).toBe(GRADE_OK);
  });
});
