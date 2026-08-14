import type { OhlcBar } from './types.js';
import { compactFromStats, statsFromWalkForwardSignals } from './auto-backtest-truth.js';
import {
  BACKTEST_LOOKBACK_YEARS,
  DEFAULT_WARMUP,
  collectBacktestSignals,
  prepareBacktestBars,
  simulateExitTrades,
} from './swing-backtest.js';

/**
 * 3y walk-forward truth from daily bars.
 *
 * Uses non-overlapping, one-position-at-a-time trades and the actual X1–X9
 * exit simulator. Regime is resolved historically per bar (optional NIFTYBEES
 * proxy bars) so a frozen live regime does not distort the full window.
 *
 * Pass ≥5y (or full) daily history; the last 3 years are evaluated after warmup.
 */
export function truthFromBars(symbol: string, bars: OhlcBar[], regimeBars?: OhlcBar[]) {
  const prepared = prepareBacktestBars(bars, BACKTEST_LOOKBACK_YEARS, DEFAULT_WARMUP);
  if (prepared.bars.length < DEFAULT_WARMUP + 10) return null;

  const regimePrepared = regimeBars?.length
    ? prepareBacktestBars(regimeBars, BACKTEST_LOOKBACK_YEARS, DEFAULT_WARMUP).bars
    : undefined;

  const btOpts = {
    min_verdict: 'ENTER' as const,
    warmup: prepared.warmup,
    regime_bars: regimePrepared,
    freeze_regime: false,
    // Align truth with HC / followable paper: tape + realistic next-open fill.
    require_quality_tape: true,
    next_bar_open_fill: true,
  };

  const signals = collectBacktestSignals(symbol, prepared.bars, btOpts);
  if (signals.length === 0) return null;

  const trades = simulateExitTrades(symbol, prepared.bars, signals, {
    ...btOpts,
    forward_sessions: 20,
    max_trades: 100,
  });
  if (trades.length === 0) return null;
  const stats = statsFromWalkForwardSignals(
    trades.map((trade) => ({
      forward_return_pct: trade.status === 'open' ? null : trade.pnl_pct,
    })),
  );

  const evalStart = prepared.bars[Math.min(prepared.warmup, prepared.bars.length - 1)];
  const evalEnd = prepared.bars[prepared.bars.length - 1];
  const startPx = Number(evalStart?.close ?? 0);
  const endPx = Number(evalEnd?.close ?? 0);
  const buyHoldPct =
    startPx > 0 && endPx > 0 ? Math.round(((endPx - startPx) / startPx) * 1000) / 10 : null;

  return compactFromStats(stats, symbol, prepared.chart_from, prepared.chart_to, buyHoldPct);
}
