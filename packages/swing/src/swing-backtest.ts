import type { OhlcBar, SwingScanOptions } from './types.js';
import { evaluateEntry } from './evaluate-entry.js';
import { matchesEntryRules } from './entry-filters.js';
import { defaultRegime } from './market-regime.js';
import { matchesMinVerdict } from './ranker.js';
import {
  matchesBreakoutVolume,
  matchesGc9Entry,
  matchesZone52w,
  normalizeZone52w,
} from './scanner.js';
import { metricsFromBars } from './ta-helper.js';

export const DEFAULT_WARMUP = 220;
export const DEFAULT_FORWARD_SESSIONS = 20;

export interface SwingBacktestOptions extends SwingScanOptions {
  warmup?: number;
  forward_sessions?: number;
  notional_inr?: number;
}

export interface SwingBacktestSignal {
  date: string;
  price: number;
  verdict: string;
  strict_verdict: string;
  rules_passed: number;
  stop_loss: number | null;
  profit_target: number | null;
  r_multiple: number | null;
  forward_return_pct: number | null;
  hit_target: boolean;
  hit_stop: boolean;
}

export interface SwingBacktestResult {
  ok: boolean;
  symbol: string;
  bars_used: number;
  warmup: number;
  signals: SwingBacktestSignal[];
  stats: {
    signal_count: number;
    enter_count: number;
    setup_count: number;
    target_hit_rate_pct: number | null;
    stop_hit_rate_pct: number | null;
    avg_forward_return_pct: number | null;
    win_rate_pct: number | null;
  };
  engine_version: string;
  regime: Record<string, unknown>;
}

/** Collect all walk-forward signals (used by auto backtest truth + API backtest). */
export function collectBacktestSignals(
  symbol: string,
  bars: OhlcBar[],
  options: SwingBacktestOptions = {},
): SwingBacktestSignal[] {
  const warmup = options.warmup ?? DEFAULT_WARMUP;
  const forward = options.forward_sessions ?? DEFAULT_FORWARD_SESSIONS;
  const regime = options.regime ?? defaultRegime();
  const minVerdict = String(options.min_verdict ?? 'SETUP_PLUS').toUpperCase();
  const zone52w = normalizeZone52w(String(options.zone_52w ?? 'any'));
  const breakoutVolume = Boolean(options.breakout_volume);
  const gc9Only = Boolean(options.gc9_only);

  if (bars.length < warmup + 5) return [];

  const signals: SwingBacktestSignal[] = [];

  for (let i = warmup; i < bars.length; i++) {
    const slice = bars.slice(0, i + 1);
    const ta = metricsFromBars(slice, symbol, true);
    if (!ta.ta_ready) continue;
    const price = Number(ta.ta_price ?? slice[slice.length - 1]?.close ?? 0);
    if (price <= 0) continue;

    const entry = evaluateEntry(ta, price, slice, regime);
    const discovery = String(entry.discovery_verdict ?? 'AVOID');
    const strict = String(entry.strict_verdict ?? entry.verdict ?? 'AVOID');

    if (!matchesMinVerdict(strict, discovery, minVerdict)) continue;
    if (!matchesZone52w(Number(ta.ta_pct_52w ?? null), zone52w, String(ta.ta_52w_chart_zone ?? ''))) continue;
    if (!matchesBreakoutVolume(entry, ta, breakoutVolume)) continue;
    if (!matchesGc9Entry(entry, ta, price, gc9Only)) continue;
    if (!matchesEntryRules(entry, options)) continue;

    const stop = entry.stop_loss as number | null;
    const target = entry.profit_target as number | null;
    const forwardSlice = bars.slice(i + 1, i + 1 + forward);
    const fwd = forwardOutcome(price, stop, target, forwardSlice);

    signals.push({
      date: slice[slice.length - 1].time,
      price: Math.round(price * 100) / 100,
      verdict: discovery,
      strict_verdict: strict,
      rules_passed: Number(entry.rules_passed ?? 0),
      stop_loss: stop,
      profit_target: target,
      r_multiple: entry.r_multiple as number | null,
      forward_return_pct: fwd.return_pct,
      hit_target: fwd.hit_target,
      hit_stop: fwd.hit_stop,
    });
  }

  return signals;
}

function statsFromSignals(signals: SwingBacktestSignal[]) {
  const enterCount = signals.filter((s) => s.strict_verdict === 'ENTER').length;
  const setupCount = signals.filter((s) => s.verdict === 'SETUP' || s.verdict === 'ENTER').length;
  const withFwd = signals.filter((s) => s.forward_return_pct !== null);
  const wins = withFwd.filter((s) => Number(s.forward_return_pct) > 0).length;
  const hitTargets = signals.filter((s) => s.hit_target).length;
  const hitStops = signals.filter((s) => s.hit_stop).length;

  return {
    signal_count: signals.length,
    enter_count: enterCount,
    setup_count: setupCount,
    target_hit_rate_pct: signals.length ? Math.round((hitTargets / signals.length) * 1000) / 10 : null,
    stop_hit_rate_pct: signals.length ? Math.round((hitStops / signals.length) * 1000) / 10 : null,
    avg_forward_return_pct:
      withFwd.length > 0
        ? Math.round((withFwd.reduce((s, x) => s + Number(x.forward_return_pct), 0) / withFwd.length) * 100) / 100
        : null,
    win_rate_pct: withFwd.length > 0 ? Math.round((wins / withFwd.length) * 1000) / 10 : null,
  };
}

/** Walk-forward replay of E1–E11 + scan filters on daily bars. */
export function backtestSwingBars(
  symbol: string,
  bars: OhlcBar[],
  options: SwingBacktestOptions = {},
): SwingBacktestResult {
  const warmup = options.warmup ?? DEFAULT_WARMUP;
  const regime = options.regime ?? defaultRegime();

  const empty: SwingBacktestResult = {
    ok: false,
    symbol,
    bars_used: bars.length,
    warmup,
    signals: [],
    stats: {
      signal_count: 0,
      enter_count: 0,
      setup_count: 0,
      target_hit_rate_pct: null,
      stop_hit_rate_pct: null,
      avg_forward_return_pct: null,
      win_rate_pct: null,
    },
    engine_version: 'v3.9-gc9',
    regime,
  };

  if (bars.length < warmup + 5) return empty;

  const signals = collectBacktestSignals(symbol, bars, options);
  if (signals.length === 0) return empty;

  return {
    ok: true,
    symbol,
    bars_used: bars.length,
    warmup,
    signals: signals.slice(-50),
    stats: statsFromSignals(signals),
    engine_version: 'v3.9-gc9',
    regime,
  };
}

function forwardOutcome(
  entry: number,
  stop: number | null,
  target: number | null,
  forwardBars: OhlcBar[],
): { return_pct: number | null; hit_target: boolean; hit_stop: boolean } {
  if (!forwardBars.length) return { return_pct: null, hit_target: false, hit_stop: false };
  let hitTarget = false;
  let hitStop = false;
  for (const bar of forwardBars) {
    if (target !== null && bar.high >= target) hitTarget = true;
    if (stop !== null && bar.low <= stop) hitStop = true;
  }
  const last = forwardBars[forwardBars.length - 1].close;
  const returnPct = entry > 0 ? Math.round(((last - entry) / entry) * 10000) / 100 : null;
  return { return_pct: returnPct, hit_target: hitTarget, hit_stop: hitStop };
}
