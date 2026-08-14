import type { OhlcBar, SwingRule, SwingScanOptions } from './types.js';
import {
  economicEdgeGateStatus,
  expectancyFromMetrics,
  MAX_DRAWDOWN_LIVE_PCT,
  MIN_PROFIT_FACTOR_LIVE,
  type EconomicEdgeStatus,
  statsFromWalkForwardSignals,
} from './auto-backtest-truth.js';
import { evaluateEntry, ENGINE_VERSION } from './evaluate-entry.js';
import { evaluateExit } from './evaluate-exit.js';
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
import { computeTradePnl } from './trade-pnl.js';

export const DEFAULT_WARMUP = 220;
export const DEFAULT_FORWARD_SESSIONS = 20;
export const DEFAULT_NOTIONAL_INR = 15_000;
export const DEFAULT_MAX_TRADES = 25;
export const DEFAULT_COOLDOWN_BARS = 3;
/** After a hard stop / losing X1 — BSE/INDIGO research: avoid instant re-chop. */
export const STOP_COOLDOWN_BARS = 8;
/** Extra spacing on high-vol entries even after non-stop exits. */
export const HIGH_VOL_COOLDOWN_BARS = 5;
/** Evaluation window for walk-forward BT (Yahoo has no 3y range — fetch 5y then trim). */
export const BACKTEST_LOOKBACK_YEARS = 3;
export const BACKTEST_CHART_RANGE = '3y';
export const BACKTEST_METHOD = 'walk_forward_3y' as const;
/** Scaled book matching institutional R geometry: 40% @1R, 40% @2R, 20% @3R (frozen target). */
export const SWING_PARTIAL_WEIGHTS = [0.4, 0.4, 0.2] as const;
export const SWING_PARTIAL_RR = [1, 2, 3] as const;
/** Buy slippage on next-bar open fill (basis points per side). */
export const SWING_ENTRY_SLIPPAGE_BPS = 5;
/** When true (truth default), only ENTER signals with volume surge or swing-high break. */
export const DEFAULT_REQUIRE_QUALITY_TAPE = false;

export const EXIT_TRIGGER_LABELS: Record<string, string> = {
  X1: 'Stop / CTC / profit-lock',
  X2: 'Profit target',
  X3: 'Trend break',
  X4: 'RSI overbought',
  X5: 'MACD fade',
  X6: 'Trailing stop',
  X7: 'Time / scratch',
  X8: 'Price-action exit',
  X9: 'Hourly EMA bearish',
};

/**
 * Keep last `lookbackYears` of tradeable history plus `warmup` bars before the window
 * so SMA200 / regime indicators are valid from day one of the evaluation period.
 */
export function prepareBacktestBars(
  bars: OhlcBar[],
  lookbackYears = BACKTEST_LOOKBACK_YEARS,
  warmup = DEFAULT_WARMUP,
): { bars: OhlcBar[]; chart_from: string; chart_to: string; warmup: number } {
  if (!bars.length) {
    return { bars: [], chart_from: '', chart_to: '', warmup };
  }
  const lastTime = String(bars[bars.length - 1]?.time ?? '').slice(0, 10);
  const end = new Date(`${lastTime}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) {
    return {
      bars,
      chart_from: String(bars[0]?.time ?? '').slice(0, 10),
      chart_to: lastTime,
      warmup,
    };
  }
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - lookbackYears);
  const startStr = start.toISOString().slice(0, 10);

  let windowStart = bars.findIndex((b) => String(b.time).slice(0, 10) >= startStr);
  if (windowStart < 0) windowStart = 0;
  const sliceFrom = Math.max(0, windowStart - warmup);
  const prepared = bars.slice(sliceFrom);
  const tradeableIdx = Math.min(warmup, Math.max(0, prepared.length - 1));
  return {
    bars: prepared,
    chart_from: String(prepared[tradeableIdx]?.time ?? prepared[0]?.time ?? '').slice(0, 10),
    chart_to: lastTime,
    warmup,
  };
}

export interface SwingBacktestOptions extends SwingScanOptions {
  warmup?: number;
  forward_sessions?: number;
  notional_inr?: number;
  max_trades?: number;
  simulate_exits?: boolean;
  /**
   * When true (default if regime omitted), derive bull/bear from bars as-of each signal date.
   * Pass freeze_regime + regime to force one regime across the whole window.
   */
  freeze_regime?: boolean;
  /** Optional proxy bars (e.g. NIFTYBEES) for historical regime; falls back to symbol bars. */
  regime_bars?: OhlcBar[];
  /**
   * Enter at next session open (+slippage), not signal close.
   * Default true — close fills overstate expectancy for followable signals.
   */
  next_bar_open_fill?: boolean;
  /** Slippage bps applied to buy fill (default SWING_ENTRY_SLIPPAGE_BPS). */
  entry_slippage_bps?: number;
  /** Require volume surge or broke swing high (aligns BT truth with HC tape). */
  require_quality_tape?: boolean;
}

export interface BacktestRuleSnap {
  id: string;
  name: string;
  criterion: string;
  passed: boolean | null;
  detail: string;
}

/** Full “why enter” snapshot captured at signal time. */
export interface BacktestEntryWhy {
  summary: string;
  discovery_verdict: string;
  strict_verdict: string;
  entry_score: number | null;
  rules_passed: number;
  rules_hard_passed: number;
  rules_hard_total: number;
  rules_soft_passed: number;
  rules_soft_total: number;
  r_multiple: number | null;
  r_multiple_ok: boolean;
  stop_loss: number | null;
  profit_target: number | null;
  target_pct: number | null;
  passed_rule_ids: string[];
  failed_rule_ids: string[];
  soft_rule_ids: string[];
  rules: BacktestRuleSnap[];
}

/** Full “why exit” snapshot at close. */
export interface BacktestExitWhy {
  summary: string;
  reason: string;
  triggers: string[];
  trigger_labels: string[];
  details: string[];
  peak_gain_pct: number | null;
  gain_pct: number | null;
  active_stop: number | null;
  trail_armed: boolean | null;
  breakeven_armed: boolean | null;
  profit_lock_armed: boolean | null;
  rules: BacktestRuleSnap[];
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
  entry_why?: BacktestEntryWhy;
  atr_pct?: number | null;
  high_vol_entry?: boolean;
  volume_surge?: boolean;
  broke_swing_high?: boolean;
}

export interface SwingBacktestTrade {
  symbol: string;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  stop_loss: number | null;
  profit_target: number | null;
  shares: number;
  days_held: number;
  pnl_pct: number;
  /** Gross expectancy contribution before delivery charges (same as pnl_pct when charges applied only to INR). */
  pnl_pct_gross?: number;
  net_pnl_inr: number | null;
  exit_reason: string;
  exit_triggers: string[];
  /** Scaled path e.g. T1+T2+X1_BE or T1+T2+T3. */
  exit_path?: string;
  /** Realized R-multiple of the scaled book (gross, before charges). */
  realized_r?: number | null;
  rules_passed: number;
  r_multiple: number | null;
  status?: 'closed' | 'open';
  entry_why: BacktestEntryWhy;
  exit_why: BacktestExitWhy;
  peak_gain_pct: number | null;
}

export interface SwingBacktestResult {
  ok: boolean;
  symbol: string;
  bars_used: number;
  warmup: number;
  chart_from?: string;
  chart_to?: string;
  lookback_years?: number;
  method?: string;
  signals: SwingBacktestSignal[];
  trades: SwingBacktestTrade[];
  stats: {
    signal_count: number;
    enter_count: number;
    setup_count: number;
    target_hit_rate_pct: number | null;
    stop_hit_rate_pct: number | null;
    avg_forward_return_pct: number | null;
    win_rate_pct: number | null;
    trades_closed: number;
    trade_win_rate_pct: number | null;
    profit_factor: number | null;
    avg_hold_days: number | null;
    net_pnl_inr: number | null;
    expectancy_pct: number | null;
    compounded_return_pct: number | null;
    max_drawdown_pct: number | null;
    avg_realized_r: number | null;
    economic_edge_status: EconomicEdgeStatus;
    economic_edge_ok: boolean;
  };
  economic?: {
    min_expectancy_pct: number;
    min_profit_factor: number;
    max_drawdown_pct: number;
    status: EconomicEdgeStatus;
    pass: boolean;
  };
  disclaimer?: string;
  engine_version: string;
  regime: Record<string, unknown>;
}

function snapRules(rules: SwingRule[] | undefined | null): BacktestRuleSnap[] {
  if (!Array.isArray(rules)) return [];
  return rules.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? r.id),
    criterion: String(r.criterion ?? ''),
    passed: r.passed === null ? null : Boolean(r.passed),
    detail: String(r.detail ?? ''),
  }));
}

function emptyEntryWhy(partial?: Partial<BacktestEntryWhy>): BacktestEntryWhy {
  return {
    summary: partial?.summary ?? 'Entry context unavailable',
    discovery_verdict: partial?.discovery_verdict ?? '—',
    strict_verdict: partial?.strict_verdict ?? '—',
    entry_score: partial?.entry_score ?? null,
    rules_passed: partial?.rules_passed ?? 0,
    rules_hard_passed: partial?.rules_hard_passed ?? 0,
    rules_hard_total: partial?.rules_hard_total ?? 8,
    rules_soft_passed: partial?.rules_soft_passed ?? 0,
    rules_soft_total: partial?.rules_soft_total ?? 4,
    r_multiple: partial?.r_multiple ?? null,
    r_multiple_ok: partial?.r_multiple_ok ?? false,
    stop_loss: partial?.stop_loss ?? null,
    profit_target: partial?.profit_target ?? null,
    target_pct: partial?.target_pct ?? null,
    passed_rule_ids: partial?.passed_rule_ids ?? [],
    failed_rule_ids: partial?.failed_rule_ids ?? [],
    soft_rule_ids: partial?.soft_rule_ids ?? [],
    rules: partial?.rules ?? [],
  };
}

export function buildEntryWhy(entry: Record<string, unknown>): BacktestEntryWhy {
  const rules = snapRules(entry.rules as SwingRule[] | undefined);
  const passedIds = rules.filter((r) => r.passed === true).map((r) => r.id);
  const failedIds = rules.filter((r) => r.passed === false).map((r) => r.id);
  const softIds = rules.filter((r) => r.passed === null).map((r) => r.id);
  const discovery = String(entry.discovery_verdict ?? 'AVOID');
  const strict = String(entry.strict_verdict ?? entry.verdict ?? 'AVOID');
  const score = entry.entry_score != null ? Number(entry.entry_score) : null;
  const hardPassed = Number(entry.rules_hard_passed ?? passedIds.length);
  const hardTotal = Number(entry.rules_hard_total ?? 8);
  const softPassed = Number(entry.rules_soft_passed ?? 0);
  const softTotal = Number(entry.rules_soft_total ?? 4);
  const rMult = entry.r_multiple != null ? Number(entry.r_multiple) : null;
  const stop = entry.stop_loss != null ? Number(entry.stop_loss) : null;
  const target = entry.profit_target != null ? Number(entry.profit_target) : null;
  const targetPct = entry.target_pct != null ? Number(entry.target_pct) : null;
  const parts = [
    `${discovery} → strict ${strict}`,
    score != null && Number.isFinite(score) ? `score ${score}` : null,
    `hard ${hardPassed}/${hardTotal}`,
    softPassed > 0 ? `soft ${softPassed}/${softTotal}` : null,
    rMult != null && Number.isFinite(rMult) ? `R ${rMult.toFixed(2)}${entry.r_multiple_ok ? '' : ' (low)'}` : null,
    targetPct != null && Number.isFinite(targetPct) ? `tgt ${targetPct.toFixed(1)}%` : null,
    passedIds.length ? `pass ${passedIds.join(',')}` : null,
    failedIds.length ? `fail ${failedIds.join(',')}` : null,
  ].filter(Boolean);
  return {
    summary: parts.join(' · '),
    discovery_verdict: discovery,
    strict_verdict: strict,
    entry_score: score != null && Number.isFinite(score) ? score : null,
    rules_passed: Number(entry.rules_passed ?? passedIds.length),
    rules_hard_passed: hardPassed,
    rules_hard_total: hardTotal,
    rules_soft_passed: softPassed,
    rules_soft_total: softTotal,
    r_multiple: rMult != null && Number.isFinite(rMult) ? Math.round(rMult * 100) / 100 : null,
    r_multiple_ok: Boolean(entry.r_multiple_ok),
    stop_loss: stop != null && Number.isFinite(stop) ? Math.round(stop * 100) / 100 : null,
    profit_target: target != null && Number.isFinite(target) ? Math.round(target * 100) / 100 : null,
    target_pct: targetPct != null && Number.isFinite(targetPct) ? Math.round(targetPct * 100) / 100 : null,
    passed_rule_ids: passedIds,
    failed_rule_ids: failedIds,
    soft_rule_ids: softIds,
    rules,
  };
}

function triggerLabels(triggers: string[]): string[] {
  return triggers.map((id) => EXIT_TRIGGER_LABELS[id] ?? id);
}

export function buildExitWhy(input: {
  reason: string;
  triggers: string[];
  entryPrice: number;
  exitPrice: number;
  stop?: number | null;
  target?: number | null;
  peakGainPct?: number | null;
  exitEval?: ReturnType<typeof evaluateExit> | null;
}): BacktestExitWhy {
  const triggers = input.triggers.map(String);
  const labels = triggerLabels(triggers);
  const rules = snapRules(input.exitEval?.rules as SwingRule[] | undefined);
  const triggeredRules = rules.filter((r) => triggers.includes(r.id) && r.passed === true);
  const details =
    triggeredRules.length > 0
      ? triggeredRules.map((r) => `${r.id} ${r.name}: ${r.detail}`)
      : [];

  const peak =
    input.peakGainPct != null && Number.isFinite(input.peakGainPct)
      ? Math.round(input.peakGainPct * 100) / 100
      : input.exitEval?.peak_gain_pct != null
        ? Number(input.exitEval.peak_gain_pct)
        : null;
  const gain =
    input.entryPrice > 0
      ? Math.round(((input.exitPrice - input.entryPrice) / input.entryPrice) * 10000) / 100
      : null;

  if (details.length === 0) {
    if (input.reason === 'stop') {
      details.push(
        `Hard stop hit — low ≤ ₹${Number(input.stop ?? 0).toFixed(2)} (X1). Peak MFE ${peak ?? '—'}%.`,
      );
    } else if (input.reason === 'target') {
      details.push(
        `Profit target hit — high ≥ ₹${Number(input.target ?? 0).toFixed(2)} (X2).`,
      );
    } else if (input.reason === 'time_stop') {
      details.push('Max hold / time stop reached without target (X7).');
    }
  }

  const summaryParts = [
    labels.length ? labels.join(' + ') : input.reason,
    triggers.length ? triggers.join(',') : null,
    gain != null ? `P&L ${gain >= 0 ? '+' : ''}${gain}%` : null,
    peak != null ? `peak +${peak}%` : null,
  ].filter(Boolean);

  return {
    summary: summaryParts.join(' · '),
    reason: input.reason,
    triggers,
    trigger_labels: labels,
    details,
    peak_gain_pct: peak,
    gain_pct: gain,
    active_stop:
      input.exitEval?.active_stop != null ? Number(input.exitEval.active_stop) : input.stop ?? null,
    trail_armed: input.exitEval?.trail_armed ?? null,
    breakeven_armed: input.exitEval?.breakeven_armed ?? null,
    profit_lock_armed: input.exitEval?.profit_lock_armed ?? null,
    rules: rules.length ? rules : triggeredRules,
  };
}

function resolveBacktestRegime(
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
  return options.regime ?? defaultRegime('backtest_warmup');
}

/** Collect all walk-forward signals (used by auto backtest truth + API backtest). */
export function collectBacktestSignals(
  symbol: string,
  bars: OhlcBar[],
  options: SwingBacktestOptions = {},
): SwingBacktestSignal[] {
  const warmup = options.warmup ?? DEFAULT_WARMUP;
  const forward = options.forward_sessions ?? DEFAULT_FORWARD_SESSIONS;
  const minVerdict = String(options.min_verdict ?? 'SETUP_PLUS').toUpperCase();
  const zone52w = normalizeZone52w(String(options.zone_52w ?? 'any'));
  const breakoutVolume = Boolean(options.breakout_volume);
  const gc9Only = Boolean(options.gc9_only);
  const requireTape = Boolean(options.require_quality_tape);

  if (bars.length < warmup + 5) return [];

  const signals: SwingBacktestSignal[] = [];

  for (let i = warmup; i < bars.length; i++) {
    const slice = bars.slice(0, i + 1);
    const ta = metricsFromBars(slice, symbol, true);
    if (!ta.ta_ready) continue;
    const price = Number(ta.ta_price ?? slice[slice.length - 1]?.close ?? 0);
    if (price <= 0) continue;

    const asOf = String(slice[slice.length - 1]?.time ?? '').slice(0, 10);
    const regime = resolveBacktestRegime(options, slice, asOf);
    const entry = evaluateEntry(ta, price, slice, regime);
    const discovery = String(entry.discovery_verdict ?? 'AVOID');
    const strict = String(entry.strict_verdict ?? entry.verdict ?? 'AVOID');

    if (!matchesMinVerdict(strict, discovery, minVerdict)) continue;
    if (!matchesZone52w(Number(ta.ta_pct_52w ?? null), zone52w, String(ta.ta_52w_chart_zone ?? ''))) continue;
    if (!matchesBreakoutVolume(entry, ta, breakoutVolume)) continue;
    if (!matchesGc9Entry(entry, ta, price, gc9Only)) continue;
    if (!matchesEntryRules(entry, options)) continue;

    const volumeSurge = Boolean(entry.volume_surge);
    const brokeSwingHigh = Boolean(entry.broke_swing_high);
    if (requireTape && !(volumeSurge || brokeSwingHigh)) continue;

    const stop = entry.stop_loss as number | null;
    const target = entry.profit_target as number | null;
    const forwardSlice = bars.slice(i + 1, i + 1 + forward);
    const fwd = forwardOutcome(price, stop, target, forwardSlice);
    const entryWhy = buildEntryWhy(entry as unknown as Record<string, unknown>);

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
      entry_why: entryWhy,
      atr_pct: (entry.atr_pct as number | null | undefined) ?? null,
      high_vol_entry: Boolean(entry.high_vol_entry),
      volume_surge: volumeSurge,
      broke_swing_high: brokeSwingHigh,
    });
  }

  return signals;
}

function netPnlFromScaledFills(
  entryPrice: number,
  shares: number,
  fills: Array<{ weight: number; price: number }>,
): number | null {
  if (shares <= 0 || entryPrice <= 0 || fills.length === 0) return null;
  let allocated = 0;
  let net = 0;
  for (let i = 0; i < fills.length; i++) {
    const isLast = i === fills.length - 1;
    const sh = isLast
      ? Math.max(0, shares - allocated)
      : Math.max(0, Math.floor(shares * fills[i].weight));
    allocated += sh;
    if (sh <= 0) continue;
    net += computeTradePnl(entryPrice, fills[i].price, sh).net_pnl;
  }
  return Math.round(net * 100) / 100;
}

/**
 * Simulate closed trades with scaled 1R/2R/3R book + X1–X9 on the runner.
 * Non-overlapping: one position at a time with a short cooldown.
 *
 * Fill model (default): signal @ close → enter next session open + slippage.
 * Gaps through the stop are skipped (no fill) — matches followable live orders.
 *
 * Partials (default): 40% @1R, 40% @2R, 20% @ frozen 3R target.
 * After T1, hard stop ratchets to breakeven; trail/profit-lock can raise further.
 */
export function simulateExitTrades(
  symbol: string,
  bars: OhlcBar[],
  signals: SwingBacktestSignal[],
  options: SwingBacktestOptions = {},
): SwingBacktestTrade[] {
  const notional = options.notional_inr ?? DEFAULT_NOTIONAL_INR;
  const maxTrades = options.max_trades ?? DEFAULT_MAX_TRADES;
  const maxHold = options.forward_sessions ?? DEFAULT_FORWARD_SESSIONS;
  const nextBarFill = options.next_bar_open_fill !== false;
  const slipBps = Number(options.entry_slippage_bps ?? SWING_ENTRY_SLIPPAGE_BPS);
  const trades: SwingBacktestTrade[] = [];

  const barIndex = new Map(bars.map((b, i) => [b.time.slice(0, 10), i]));
  let nextAllowedIdx = 0;

  for (const sig of signals) {
    if (trades.length >= maxTrades) break;
    const signalIdx = barIndex.get(sig.date.slice(0, 10));
    if (signalIdx == null || signalIdx < nextAllowedIdx) continue;
    if (signalIdx >= bars.length - 1) continue;

    const planStop = sig.stop_loss;
    const planTarget = sig.profit_target;

    let fillIdx = signalIdx;
    let entryPrice = sig.price;
    let entryDate = sig.date.slice(0, 10);

    if (nextBarFill) {
      fillIdx = signalIdx + 1;
      if (fillIdx >= bars.length) continue;
      const openPx = Number(bars[fillIdx]?.open ?? 0);
      if (!(openPx > 0)) continue;
      // Gap through stop — order would not be workable for a follower.
      if (planStop != null && openPx <= planStop) {
        nextAllowedIdx = fillIdx + 1;
        continue;
      }
      entryPrice = Math.round(openPx * (1 + slipBps / 10_000) * 100) / 100;
      entryDate = bars[fillIdx].time.slice(0, 10);
      if (planStop != null && planStop >= entryPrice) {
        nextAllowedIdx = fillIdx + 1;
        continue;
      }
    }

    const stop = planStop;
    const target = planTarget;
    const risk = stop != null && stop < entryPrice ? entryPrice - stop : 0;
    const shares = entryPrice > 0 ? Math.floor(notional / entryPrice) : 0;

    const t1 = risk > 0 ? Math.round((entryPrice + SWING_PARTIAL_RR[0] * risk) * 100) / 100 : null;
    const t2 = risk > 0 ? Math.round((entryPrice + SWING_PARTIAL_RR[1] * risk) * 100) / 100 : null;
    const t3 =
      target != null && target > entryPrice
        ? target
        : risk > 0
          ? Math.round((entryPrice + SWING_PARTIAL_RR[2] * risk) * 100) / 100
          : null;

    let highWater = entryPrice;
    let activeStop = stop;
    let exitPrice = entryPrice;
    let exitDate = entryDate;
    let exitReason = 'time_stop';
    let exitTriggers: string[] = [];
    let daysHeld = 0;
    let lastExitEval: ReturnType<typeof evaluateExit> | null = null;
    let remaining = 1;
    let realizedPct = 0;
    let realizedR = 0;
    let t1Done = false;
    let t2Done = false;
    const path: string[] = [];
    const fills: Array<{ weight: number; price: number }> = [];
    const w = SWING_PARTIAL_WEIGHTS;

    const bookPartial = (weight: number, px: number, label: string) => {
      if (weight <= 0 || entryPrice <= 0) return;
      const pct = ((px - entryPrice) / entryPrice) * 100;
      realizedPct += weight * pct;
      if (risk > 0) realizedR += weight * ((px - entryPrice) / risk);
      remaining = Math.max(0, remaining - weight);
      exitPrice = px;
      path.push(label);
      fills.push({ weight, price: px });
    };

    const holdEnd = Math.min(bars.length - 1, fillIdx + maxHold);
    const manageStart = nextBarFill ? fillIdx : fillIdx + 1;
    for (let j = manageStart; j <= holdEnd; j++) {
      const bar = bars[j];
      highWater = Math.max(highWater, bar.high);
      daysHeld = Math.max(1, j - (nextBarFill ? fillIdx : signalIdx));
      const slice = bars.slice(0, j + 1);
      const asOf = bar.time.slice(0, 10);
      const regime = resolveBacktestRegime(options, slice, asOf);

      // Stop first (same-bar conservative).
      if (activeStop != null && bar.low <= activeStop) {
        const stopPx = Math.min(bar.open, activeStop);
        const stopWeight = remaining;
        const stopR = risk > 0 ? (stopPx - entryPrice) / risk : 0;
        realizedPct += remaining * ((stopPx - entryPrice) / entryPrice) * 100;
        realizedR += remaining * stopR;
        if (stopWeight > 0) fills.push({ weight: stopWeight, price: stopPx });
        remaining = 0;
        exitPrice = stopPx;
        exitDate = bar.time;
        exitReason = t1Done ? 'breakeven_stop' : 'stop';
        exitTriggers = ['X1'];
        path.push(t1Done ? 'X1_BE' : 'X1');
        const ta = metricsFromBars(slice, symbol, true);
        lastExitEval = evaluateExit(
          { ...ta, as_of_date: asOf },
          exitPrice,
          entryPrice,
          entryDate,
          null,
          highWater,
          slice,
          slice,
          target,
          null,
          regime,
          null,
          activeStop,
        );
        break;
      }

      // Scaled targets — book in order on the same bar if multiple print.
      if (remaining > 0 && !t1Done && t1 != null && bar.high >= t1) {
        bookPartial(Math.min(w[0], remaining), t1, 'T1');
        t1Done = true;
        activeStop = entryPrice;
        exitDate = bar.time;
        exitReason = 'partial';
        exitTriggers = ['X2'];
      }
      if (remaining > 0 && t1Done && !t2Done && t2 != null && bar.high >= t2) {
        bookPartial(Math.min(w[1], remaining), t2, 'T2');
        t2Done = true;
        exitDate = bar.time;
        exitReason = 'partial';
        exitTriggers = ['X2'];
      }
      if (remaining > 0 && t2Done && t3 != null && bar.high >= t3) {
        bookPartial(remaining, Math.max(bar.open, t3), 'T3');
        remaining = 0;
        exitDate = bar.time;
        exitReason = 'target';
        exitTriggers = ['X2'];
        const ta = metricsFromBars(slice, symbol, true);
        lastExitEval = evaluateExit(
          { ...ta, as_of_date: asOf },
          exitPrice,
          entryPrice,
          entryDate,
          null,
          highWater,
          slice,
          slice,
          target,
          null,
          regime,
          null,
          activeStop,
        );
        break;
      }

      if (remaining <= 0) break;

      const ta = metricsFromBars(slice, symbol, true);
      const price = bar.close;
      const exit = evaluateExit(
        { ...ta, as_of_date: asOf },
        price,
        entryPrice,
        entryDate,
        null,
        highWater,
        slice,
        slice,
        target,
        null,
        regime,
        null,
        activeStop,
      );
      lastExitEval = exit;
      if (exit.trail_stop != null) {
        activeStop = Math.max(activeStop ?? 0, exit.trail_stop);
      }
      if (exit.active_stop != null && Number(exit.active_stop) > (activeStop ?? 0)) {
        activeStop = Number(exit.active_stop);
      }

      if (String(exit.verdict) === 'EXIT') {
        const pct = ((price - entryPrice) / entryPrice) * 100;
        const wt = remaining;
        realizedPct += remaining * pct;
        if (risk > 0) realizedR += remaining * ((price - entryPrice) / risk);
        if (wt > 0) fills.push({ weight: wt, price });
        remaining = 0;
        exitPrice = price;
        exitDate = bar.time;
        exitReason = 'exit_rules';
        exitTriggers = Array.isArray(exit.triggered) ? exit.triggered.map(String) : [];
        path.push(exitTriggers[0] ?? 'EXIT');
        break;
      }

      if (j === holdEnd) {
        const pct = ((price - entryPrice) / entryPrice) * 100;
        const wt = remaining;
        realizedPct += remaining * pct;
        if (risk > 0) realizedR += remaining * ((price - entryPrice) / risk);
        if (wt > 0) fills.push({ weight: wt, price });
        remaining = 0;
        exitPrice = price;
        exitDate = bar.time;
        exitReason = 'time_stop';
        exitTriggers = ['X7'];
        path.push('X7');
        break;
      }
    }

    const pnlPctGross = Math.round(realizedPct * 100) / 100;
    const netPnlInr = shares > 0 ? netPnlFromScaledFills(entryPrice, shares, fills) : null;

    const peakGainPct =
      entryPrice > 0 ? Math.round(((highWater - entryPrice) / entryPrice) * 10000) / 100 : null;
    const exitWhy = buildExitWhy({
      reason: exitReason,
      triggers: exitTriggers,
      entryPrice,
      exitPrice,
      stop,
      target,
      peakGainPct,
      exitEval: lastExitEval,
    });
    if (path.length) {
      exitWhy.details = [
        `Scaled book ${path.join('+')} (40/40/20 @1R/2R/3R; BE after T1). Realized ~${Math.round(realizedR * 100) / 100}R.`,
        ...exitWhy.details,
      ];
      exitWhy.summary = `${path.join('+')} · ${exitWhy.summary}`;
    }

    trades.push({
      symbol,
      entry_date: entryDate,
      exit_date: exitDate.slice(0, 10),
      entry_price: Math.round(entryPrice * 100) / 100,
      exit_price: Math.round(exitPrice * 100) / 100,
      stop_loss: stop,
      profit_target: target,
      shares,
      days_held: daysHeld,
      pnl_pct: pnlPctGross,
      pnl_pct_gross: pnlPctGross,
      net_pnl_inr: netPnlInr,
      exit_reason: exitReason,
      exit_triggers: exitTriggers,
      exit_path: path.join('+') || exitReason,
      realized_r: Math.round(realizedR * 100) / 100,
      rules_passed: sig.rules_passed,
      r_multiple: sig.r_multiple,
      status: 'closed',
      entry_why:
        sig.entry_why ??
        emptyEntryWhy({
          summary: `${sig.verdict} → strict ${sig.strict_verdict} · rules ${sig.rules_passed}`,
          discovery_verdict: sig.verdict,
          strict_verdict: sig.strict_verdict,
          rules_passed: sig.rules_passed,
          r_multiple: sig.r_multiple,
          stop_loss: sig.stop_loss,
          profit_target: sig.profit_target,
        }),
      exit_why: exitWhy,
      peak_gain_pct: peakGainPct,
    });

    const exitIdx = barIndex.get(exitDate.slice(0, 10)) ?? fillIdx;
    let cooldown = DEFAULT_COOLDOWN_BARS;
    if (exitReason === 'stop' || (exitTriggers.includes('X1') && pnlPctGross < 0)) {
      cooldown = STOP_COOLDOWN_BARS;
    } else if (sig.high_vol_entry) {
      cooldown = HIGH_VOL_COOLDOWN_BARS;
    }
    nextAllowedIdx = exitIdx + cooldown;
  }

  return trades;
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

function emptyTradeStats() {
  return {
    trades_closed: 0,
    trade_win_rate_pct: null as number | null,
    profit_factor: null as number | null,
    avg_hold_days: null as number | null,
    net_pnl_inr: null as number | null,
    expectancy_pct: null as number | null,
    compounded_return_pct: null as number | null,
    max_drawdown_pct: null as number | null,
    avg_realized_r: null as number | null,
    economic_edge_status: 'missing' as EconomicEdgeStatus,
    economic_edge_ok: false,
  };
}

function statsFromTrades(trades: SwingBacktestTrade[]) {
  if (!trades.length) return emptyTradeStats();

  const wf = statsFromWalkForwardSignals(
    trades.map((t) => ({ forward_return_pct: t.status === 'open' ? null : t.pnl_pct })),
  );
  const expectancy = expectancyFromMetrics(wf);
  const edgeStatus = economicEdgeGateStatus({
    trades_closed: wf.trades_closed,
    profit_factor: wf.profit_factor,
    compounded_return_pct: wf.compounded_return_pct,
    max_drawdown_pct: wf.max_drawdown_pct,
    expectancy_pct: expectancy,
    win_rate_pct: wf.win_rate_pct,
    avg_win_pct: wf.avg_win_pct,
    avg_loss_pct: wf.avg_loss_pct,
  });
  const netSum = trades.reduce((s, t) => s + Number(t.net_pnl_inr ?? 0), 0);
  const avgHold = Math.round((trades.reduce((s, t) => s + t.days_held, 0) / trades.length) * 10) / 10;
  const rVals = trades.map((t) => t.realized_r).filter((r): r is number => r != null && Number.isFinite(r));
  const avgR =
    rVals.length > 0 ? Math.round((rVals.reduce((a, b) => a + b, 0) / rVals.length) * 100) / 100 : null;

  return {
    trades_closed: wf.trades_closed,
    trade_win_rate_pct: wf.win_rate_pct,
    profit_factor: wf.profit_factor,
    avg_hold_days: avgHold,
    net_pnl_inr: Math.round(netSum * 100) / 100,
    expectancy_pct: expectancy,
    compounded_return_pct: wf.compounded_return_pct,
    max_drawdown_pct: wf.max_drawdown_pct,
    avg_realized_r: avgR,
    economic_edge_status: edgeStatus,
    economic_edge_ok: edgeStatus === 'pass',
  };
}

/** Walk-forward replay of E1–E12 + optional X1–X9 exit simulation. */
export function backtestSwingBars(
  symbol: string,
  bars: OhlcBar[],
  options: SwingBacktestOptions = {},
): SwingBacktestResult {
  const warmup = options.warmup ?? DEFAULT_WARMUP;
  const regime = options.regime ?? defaultRegime();
  const simulateExits = options.simulate_exits !== false;

  const emptyStats = {
    signal_count: 0,
    enter_count: 0,
    setup_count: 0,
    target_hit_rate_pct: null as number | null,
    stop_hit_rate_pct: null as number | null,
    avg_forward_return_pct: null as number | null,
    win_rate_pct: null as number | null,
    ...emptyTradeStats(),
  };

  const disclaimer =
    'Scaled exits 40/40/20 at 1R/2R/3R with BE after T1; X1–X9 on the runner. Net ₹ uses delivery charge model. Economic edge: expectancy>0, PF≥1.25, compound≥0, max DD≤20%. Past matrix ≠ future returns.';

  const empty: SwingBacktestResult = {
    ok: false,
    symbol,
    bars_used: bars.length,
    warmup,
    signals: [],
    trades: [],
    stats: emptyStats,
    economic: {
      min_expectancy_pct: 0,
      min_profit_factor: MIN_PROFIT_FACTOR_LIVE,
      max_drawdown_pct: MAX_DRAWDOWN_LIVE_PCT,
      status: 'missing',
      pass: false,
    },
    disclaimer,
    engine_version: ENGINE_VERSION,
    regime,
  };

  if (bars.length < warmup + 5) return empty;

  const signals = collectBacktestSignals(symbol, bars, options);
  if (signals.length === 0) return empty;

  const trades = simulateExits ? simulateExitTrades(symbol, bars, signals, options) : [];
  const signalStats = statsFromSignals(signals);
  const tradeStats = statsFromTrades(trades);

  return {
    ok: true,
    symbol,
    bars_used: bars.length,
    warmup,
    chart_from: String(bars[Math.min(warmup, bars.length - 1)]?.time ?? '').slice(0, 10),
    chart_to: String(bars[bars.length - 1]?.time ?? '').slice(0, 10),
    lookback_years: BACKTEST_LOOKBACK_YEARS,
    method: BACKTEST_METHOD,
    signals: signals.slice(-50),
    trades: trades.slice(-40),
    stats: { ...signalStats, ...tradeStats },
    economic: {
      min_expectancy_pct: 0,
      min_profit_factor: MIN_PROFIT_FACTOR_LIVE,
      max_drawdown_pct: MAX_DRAWDOWN_LIVE_PCT,
      status: tradeStats.economic_edge_status,
      pass: tradeStats.economic_edge_ok,
    },
    disclaimer,
    engine_version: ENGINE_VERSION,
    regime,
  };
}

export function forwardOutcome(
  entry: number,
  stop: number | null,
  target: number | null,
  forwardBars: OhlcBar[],
): { return_pct: number | null; hit_target: boolean; hit_stop: boolean } {
  if (!forwardBars.length) return { return_pct: null, hit_target: false, hit_stop: false };
  for (const bar of forwardBars) {
    const hitTarget = target !== null && bar.high >= target;
    const hitStop = stop !== null && bar.low <= stop;
    // Daily OHLC cannot reveal intraday ordering. If both levels print in the
    // same bar, use the stop first to avoid optimistic look-ahead bias.
    if (hitStop) {
      const returnPct = entry > 0 && stop !== null
        ? Math.round(((stop - entry) / entry) * 10000) / 100
        : null;
      return { return_pct: returnPct, hit_target: false, hit_stop: true };
    }
    if (hitTarget) {
      const returnPct = entry > 0 && target !== null
        ? Math.round(((target - entry) / entry) * 10000) / 100
        : null;
      return { return_pct: returnPct, hit_target: true, hit_stop: false };
    }
  }
  const last = forwardBars[forwardBars.length - 1].close;
  const returnPct = entry > 0 ? Math.round(((last - entry) / entry) * 10000) / 100 : null;
  return { return_pct: returnPct, hit_target: false, hit_stop: false };
}
