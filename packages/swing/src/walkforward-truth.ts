import type { OhlcBar } from './types.js';
import { compactFromStats, statsFromWalkForwardSignals } from './auto-backtest-truth.js';
import { collectBacktestSignals } from './swing-backtest.js';

/** 2y walk-forward truth from daily bars (SETUP+ signals, 20-session forward). */
export function truthFromBars(symbol: string, bars: OhlcBar[]) {
  if (bars.length < 230) return null;

  const signals = collectBacktestSignals(symbol, bars, { min_verdict: 'SETUP_PLUS' });
  if (signals.length === 0) return null;

  const stats = statsFromWalkForwardSignals(signals);
  const first = bars[0]?.time ?? '';
  const last = bars[bars.length - 1]?.time ?? '';

  return compactFromStats(stats, symbol, String(first).slice(0, 10), String(last).slice(0, 10));
}
