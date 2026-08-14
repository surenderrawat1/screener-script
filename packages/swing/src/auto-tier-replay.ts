import { VOLUME_SURGE_MIN } from './dynamic-signals.js';
import { evaluateEntry } from './evaluate-entry.js';
import { matchesEntryRules } from './entry-filters.js';
import { defaultRegime, regimeFromBars } from './market-regime.js';
import { matchesMinVerdict } from './ranker.js';
import {
  matchesBreakoutVolume,
  matchesGc9Entry,
  matchesZone52w,
  normalizeZone52w,
} from './scanner.js';
import { metricsFromBars } from './ta-helper.js';
import {
  compactFromStats,
  economicEdgeGateStatus,
  statsFromWalkForwardSignals,
  type BacktestTruthCompact,
} from './auto-backtest-truth.js';
import {
  DEFAULT_FORWARD_SESSIONS,
  DEFAULT_MAX_TRADES,
  DEFAULT_WARMUP,
  simulateExitTrades,
  type SwingBacktestOptions,
  type SwingBacktestSignal,
} from './swing-backtest.js';
import type { OhlcBar } from './types.js';

export const AUTO_TIER_IDS = [
  'high_conviction',
  'strict_enter',
  'setup_radar',
  'breakout_surge',
] as const;

export type AutoTierId = (typeof AUTO_TIER_IDS)[number];

export const AUTO_TIER_LABELS: Record<AutoTierId, string> = {
  high_conviction: 'High conviction (structural)',
  strict_enter: 'Strict ENTER',
  setup_radar: 'Setup radar',
  breakout_surge: 'Breakout surge',
};

export type TierReplayRow = {
  tier: AutoTierId;
  label: string;
  signals: number;
  trades: number;
  expectancy_pct: number;
  profit_factor: number;
  compounded_return_pct: number;
  max_drawdown_pct: number;
  win_rate_pct: number;
  grade: string;
  edge: string;
};

export type AutoTierReplayResult = {
  ok: boolean;
  symbol: string;
  chart_from: string;
  chart_to: string;
  method: 'auto_tier_replay_3y';
  /** HC uses structural tape/score gates — not circular BT economic-edge truth. */
  hc_note: string;
  tiers: TierReplayRow[];
};

type TaggedSignal = SwingBacktestSignal & {
  tiers: AutoTierId[];
  decision_score: number;
};

function resolveRegime(
  options: SwingBacktestOptions,
  symbolBarsThrough: OhlcBar[],
  asOfDate: string,
): Record<string, unknown> {
  if (options.freeze_regime && options.regime) return options.regime;
  const proxy = options.regime_bars?.length ? options.regime_bars : symbolBarsThrough;
  const date = asOfDate.slice(0, 10);
  const through = proxy.filter((b) => String(b.time).slice(0, 10) <= date);
  if (through.length >= 60) return regimeFromBars(through, date);
  if (symbolBarsThrough.length >= 60) return regimeFromBars(symbolBarsThrough, date);
  return options.regime ?? defaultRegime('tier_replay_warmup');
}

/**
 * Structural HC for historical replay (no look-ahead BT truth).
 * Mirrors live tape/score/R gates; economic-edge gate is applied on the tier's own OOS path.
 */
export function isStructuralHighConviction(hit: Record<string, unknown>): boolean {
  if (String(hit.strict_verdict ?? '') !== 'ENTER') return false;
  if (hit.r_multiple_ok !== true) return false;
  if (hit.strict_enter_ready === false) return false;

  const rsi = Number(hit.ta_rsi14 ?? 0);
  const pct52 = Number(hit.ta_pct_52w ?? 0);
  if (rsi >= 72) return false;
  if (pct52 >= 88) return false;

  const score = Number(hit.entry_score ?? hit.decision_score ?? 0);
  const tape = hit.volume_surge === true || hit.broke_swing_high === true;
  if (hit.high_vol_entry === true && !tape) return false;
  if (!tape && score < 80) return false;
  if (score < 72) return false;
  return true;
}

export function classifyAutoTiersAtEntry(hit: Record<string, unknown>): AutoTierId[] {
  const tiers: AutoTierId[] = [];
  const discovery = String(hit.verdict ?? hit.discovery_verdict ?? '');
  const strict = String(hit.strict_verdict ?? '');
  const volRatio = Number(hit.ta_volume_ratio ?? 0);

  if (strict === 'ENTER') tiers.push('strict_enter');
  if (['ENTER', 'SETUP'].includes(discovery)) tiers.push('setup_radar');
  if (hit.broke_swing_high === true && volRatio >= VOLUME_SURGE_MIN) tiers.push('breakout_surge');
  if (isStructuralHighConviction(hit)) tiers.push('high_conviction');
  return tiers;
}

function collectTaggedSignals(
  symbol: string,
  bars: OhlcBar[],
  options: SwingBacktestOptions,
): TaggedSignal[] {
  const warmup = options.warmup ?? DEFAULT_WARMUP;
  const minVerdict = String(options.min_verdict ?? 'SETUP_PLUS').toUpperCase();
  const zone52w = normalizeZone52w(String(options.zone_52w ?? 'any'));
  const breakoutVolume = Boolean(options.breakout_volume);
  const gc9Only = Boolean(options.gc9_only);
  if (bars.length < warmup + 5) return [];

  const out: TaggedSignal[] = [];
  for (let i = warmup; i < bars.length; i++) {
    const slice = bars.slice(0, i + 1);
    const ta = metricsFromBars(slice, symbol, true);
    if (!ta.ta_ready) continue;
    const price = Number(ta.ta_price ?? slice[slice.length - 1]?.close ?? 0);
    if (price <= 0) continue;

    const asOf = String(slice[slice.length - 1]?.time ?? '').slice(0, 10);
    const regime = resolveRegime(options, slice, asOf);
    const entry = evaluateEntry(ta, price, slice, regime) as Record<string, unknown>;
    const discovery = String(entry.discovery_verdict ?? 'AVOID');
    const strict = String(entry.strict_verdict ?? entry.verdict ?? 'AVOID');

    if (!matchesMinVerdict(strict, discovery, minVerdict)) continue;
    if (!matchesZone52w(Number(ta.ta_pct_52w ?? null), zone52w, String(ta.ta_52w_chart_zone ?? ''))) {
      continue;
    }
    if (!matchesBreakoutVolume(entry, ta, breakoutVolume)) continue;
    if (!matchesGc9Entry(entry, ta, price, gc9Only)) continue;
    if (!matchesEntryRules(entry, options)) continue;

    const dynamic = (entry.dynamic as Record<string, unknown> | undefined) ?? {};
    const pa = (entry.price_action as Record<string, unknown> | undefined) ?? {};
    const hit = {
      ...entry,
      verdict: discovery,
      strict_verdict: strict,
      ta_rsi14: ta.ta_rsi14,
      ta_pct_52w: ta.ta_pct_52w,
      ta_volume_ratio: ta.ta_volume_ratio,
      volume_surge: Boolean(dynamic.volume_surge ?? entry.volume_surge),
      broke_swing_high: Boolean(pa.broke_swing_high ?? entry.broke_swing_high),
      high_vol_entry: Boolean(entry.high_vol_entry),
      entry_score: Number(entry.entry_score ?? 0),
      r_multiple_ok: entry.r_multiple_ok === true,
      strict_enter_ready: entry.strict_enter_ready !== false && strict === 'ENTER',
    };
    const tiers = classifyAutoTiersAtEntry(hit);
    if (tiers.length === 0) continue;

    const stop = entry.stop_loss as number | null;
    const target = entry.profit_target as number | null;
    out.push({
      date: String(slice[slice.length - 1]?.time ?? ''),
      price: Math.round(price * 100) / 100,
      verdict: discovery,
      strict_verdict: strict,
      rules_passed: Number(entry.rules_passed ?? 0),
      stop_loss: stop,
      profit_target: target,
      r_multiple: (entry.r_multiple as number | null) ?? null,
      forward_return_pct: null,
      hit_target: false,
      hit_stop: false,
      atr_pct: (entry.atr_pct as number | null | undefined) ?? null,
      high_vol_entry: Boolean(entry.high_vol_entry),
      tiers,
      decision_score: Number(entry.entry_score ?? 0),
    });
  }
  return out;
}

function rowFromTrades(
  tier: AutoTierId,
  signalCount: number,
  trades: Array<{ pnl_pct: number }>,
  symbol: string,
  chartFrom: string,
  chartTo: string,
): TierReplayRow {
  const stats = statsFromWalkForwardSignals(
    trades.map((t) => ({ forward_return_pct: t.pnl_pct })),
  );
  const compact: BacktestTruthCompact = compactFromStats(stats, symbol, chartFrom, chartTo);
  return {
    tier,
    label: AUTO_TIER_LABELS[tier],
    signals: signalCount,
    trades: stats.trades_closed,
    expectancy_pct: compact.expectancy_pct,
    profit_factor: compact.profit_factor,
    compounded_return_pct: compact.compounded_return_pct,
    max_drawdown_pct: compact.max_drawdown_pct,
    win_rate_pct: compact.win_rate_pct,
    grade: compact.grade,
    edge: economicEdgeGateStatus(compact),
  };
}

/**
 * Walk-forward Auto-tier replay: classify each historical signal into Auto tiers,
 * then exit-simulate each tier book independently (Expectancy → CAGR → DD → PF).
 */
export function replayAutoTiers(
  symbol: string,
  bars: OhlcBar[],
  options: SwingBacktestOptions = {},
): AutoTierReplayResult {
  const warmup = options.warmup ?? DEFAULT_WARMUP;
  const chartFrom = String(bars[Math.min(warmup, Math.max(0, bars.length - 1))]?.time ?? '').slice(0, 10);
  const chartTo = String(bars[bars.length - 1]?.time ?? '').slice(0, 10);
  const empty: AutoTierReplayResult = {
    ok: false,
    symbol,
    chart_from: chartFrom,
    chart_to: chartTo,
    method: 'auto_tier_replay_3y',
    hc_note:
      'High conviction uses structural tape/score/R gates at entry (no look-ahead BT truth). Edge grade is from that tier’s own exit path.',
    tiers: AUTO_TIER_IDS.map((tier) => ({
      tier,
      label: AUTO_TIER_LABELS[tier],
      signals: 0,
      trades: 0,
      expectancy_pct: 0,
      profit_factor: 0,
      compounded_return_pct: 0,
      max_drawdown_pct: 0,
      win_rate_pct: 0,
      grade: 'UNPROVEN',
      edge: 'unproven',
    })),
  };

  const tagged = collectTaggedSignals(symbol, bars, options);
  if (tagged.length === 0) return empty;

  const simOpts: SwingBacktestOptions = {
    ...options,
    max_trades: options.max_trades ?? DEFAULT_MAX_TRADES,
    forward_sessions: options.forward_sessions ?? DEFAULT_FORWARD_SESSIONS,
  };

  const tiers = AUTO_TIER_IDS.map((tier) => {
    const signals = tagged.filter((s) => s.tiers.includes(tier));
    const trades = simulateExitTrades(symbol, bars, signals, simOpts);
    return rowFromTrades(tier, signals.length, trades, symbol, chartFrom, chartTo);
  });

  return {
    ok: true,
    symbol,
    chart_from: chartFrom,
    chart_to: chartTo,
    method: 'auto_tier_replay_3y',
    hc_note: empty.hc_note,
    tiers,
  };
}
