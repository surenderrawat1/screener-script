import { barMinutesIst, TIME_STOP_MIN } from './session-clock.js';
import { analyze as analyzeNiftyDirection, type IntradayBar } from './nifty-direction.js';
import { buildTradePlan } from './trade-plan.js';
import { confluence as mtfConfluence } from './mtf.js';
import { passes, preset, presetIds, presetOptions } from './entry-filter.js';
import { resolveExitProfile, targetsFromProfile, type ExitProfile } from './exit-profile.js';

export const MIN_INTRADAY_ACCURACY_PCT = 70;
export const MIN_INTRADAY_TRADES_PROVEN = 10;
/** Soft economic floors (diagnostic + ranking — WR gate remains for live playbook). */
export const MIN_INTRADAY_EXPECTANCY_R = 0.1;
export const MIN_INTRADAY_PROFIT_FACTOR = 1.25;
/** Paper-like cost model for net expectancy (not a live fill engine). */
export const INTRADAY_SIM_NOTIONAL_INR = 30_000;
export const INTRADAY_SIM_SLIPPAGE_BPS_PER_SIDE = 5;
export const INTRADAY_SIM_FLAT_CHARGE_INR = 45;
/** Plan book: T1 40% @1R, T2 40% @2R, T3 20% @3R — was T1-only (+1R/−1R). */
export const INTRADAY_PARTIAL_WEIGHTS = [0.4, 0.4, 0.2] as const;
export const INTRADAY_TARGET_RR = [1, 2, 3] as const;

export type IntradayAccuracyStatus = 'pass' | 'fail' | 'unproven' | 'missing';
export type IntradayEconomicStatus = 'pass' | 'fail' | 'unproven' | 'missing';

export interface IntradayChartSlice {
  bars: IntradayBar[];
  closes?: number[];
  interval?: string;
}

export interface IntradayBacktestOptions {
  interval?: '5m' | '15m';
  preset_id?: string;
  mode?: 'single' | 'combo_compare';
}

export interface IntradayBacktestTrade {
  session_date: string;
  entry: number;
  exit: number;
  r_multiple: number;
  r_gross: number;
  /** Classic T1-only R (+1 / −1 / time) — Stratzy accuracy parity. */
  r_classic: number;
  cost_r: number;
  outcome: 'win' | 'loss' | 'time';
  exit_path: string;
}

export interface IntradayPresetBacktestRow {
  preset_id: string;
  label: string;
  sessions: number;
  trades: number;
  wins: number;
  losses: number;
  /**
   * Stratzy / accuracy win rate from classic T1-only sim (+1R/−1R).
   * Restores pre-scaled-exit matrix yardstick (historically often mid-40%s).
   */
  win_rate_pct: number | null;
  /** Scaled-book gross WR (runners can give back a T1 win). */
  scaled_win_rate_pct: number | null;
  /** After-cost win rate — diagnostic only. */
  net_win_rate_pct: number | null;
  avg_r: number | null;
  /** Gross expectancy in R (scaled partials, before costs). */
  expectancy_r: number | null;
  /** Net expectancy after estimated slippage + flat charges. */
  net_expectancy_r: number | null;
  /** Classic T1-only avg R (parity with old matrix). */
  classic_avg_r: number | null;
  profit_factor: number | null;
  /** Gross PF (scaled, before costs). */
  profit_factor_gross: number | null;
  economic_status: IntradayEconomicStatus;
  economic_pass: boolean;
  accuracy_status: IntradayAccuracyStatus;
  accuracy_pass: boolean;
  accuracy_floor_pct: number;
  min_trades_required: number;
  trades_sample: IntradayBacktestTrade[];
}

export interface IntradayBacktestResult {
  ok: boolean;
  mode: string;
  interval: '5m' | '15m';
  sessions: number;
  bars_5m: number;
  bars_15m: number;
  presets: IntradayPresetBacktestRow[];
  high_accuracy: {
    floor_pct: number;
    strictly_above_floor: true;
    min_trades_required: number;
    passing_presets: string[];
    pass_count: number;
  };
  economic: {
    min_expectancy_r: number;
    min_profit_factor: number;
    passing_presets: string[];
    pass_count: number;
    best_preset_id: string | null;
  };
  disclaimer: string;
}

export function intradayAccuracyStatus(
  metrics?: { trades?: number; win_rate_pct?: number | null } | null,
): IntradayAccuracyStatus {
  if (!metrics || metrics.win_rate_pct === null || metrics.win_rate_pct === undefined) return 'missing';
  if (Number(metrics.trades ?? 0) < MIN_INTRADAY_TRADES_PROVEN) return 'unproven';
  return Number(metrics.win_rate_pct) > MIN_INTRADAY_ACCURACY_PCT ? 'pass' : 'fail';
}

export function meetsIntradayAccuracy(
  metrics?: { trades?: number; win_rate_pct?: number | null } | null,
): boolean {
  return intradayAccuracyStatus(metrics) === 'pass';
}

export function intradayEconomicStatus(metrics?: {
  trades?: number;
  net_expectancy_r?: number | null;
  profit_factor?: number | null;
} | null): IntradayEconomicStatus {
  if (!metrics) return 'missing';
  if (Number(metrics.trades ?? 0) < MIN_INTRADAY_TRADES_PROVEN) return 'unproven';
  if (metrics.net_expectancy_r == null || metrics.profit_factor == null) return 'missing';
  const e = Number(metrics.net_expectancy_r);
  const pf = Number(metrics.profit_factor);
  if (!(e > MIN_INTRADAY_EXPECTANCY_R) || pf < MIN_INTRADAY_PROFIT_FACTOR) return 'fail';
  return 'pass';
}

/**
 * Estimated round-trip cost in R-multiples.
 * Uses notional × (riskPts/entry) as rupee risk, floored at 0.75% of notional so
 * tight index stops are not crushed by ₹45 flat vs ₹30–50 of true cash risk.
 */
export function estimateIntradayCostR(
  entry: number,
  riskPts: number,
  notionalInr = INTRADAY_SIM_NOTIONAL_INR,
): number {
  if (!(entry > 0) || !(riskPts > 0) || !(notionalInr > 0)) return 0.25;
  const rawRiskInr = notionalInr * (riskPts / entry);
  const riskInr = Math.max(rawRiskInr, notionalInr * 0.0075);
  if (!(riskInr > 0)) return 0.25;
  const slip =
    (INTRADAY_SIM_SLIPPAGE_BPS_PER_SIDE / 10_000) * notionalInr * 2;
  return Math.round(((slip + INTRADAY_SIM_FLAT_CHARGE_INR) / riskInr) * 100) / 100;
}

function sessionDate(bar: IntradayBar): string {
  const label = String(bar.time_label ?? '');
  return label.slice(0, 10) || 'unknown';
}

function groupBySession(bars: IntradayBar[]): Map<string, IntradayBar[]> {
  const map = new Map<string, IntradayBar[]>();
  for (const bar of bars) {
    const key = sessionDate(bar);
    const list = map.get(key) ?? [];
    list.push(bar);
    map.set(key, list);
  }
  return map;
}

function globalIndex(allBars: IntradayBar[], sessionBars: IntradayBar[], sessionIdx: number): number {
  const bar = sessionBars[sessionIdx];
  return allBars.findIndex((b) => b.time === bar.time && b.time_label === bar.time_label);
}

function slice15mUpTo(chart15: IntradayChartSlice, bar5: IntradayBar): IntradayChartSlice {
  const label = String(bar5.time_label ?? '');
  const bars = chart15.bars.filter((b) => String(b.time_label ?? '') <= label);
  return { ...chart15, bars, closes: bars.map((b) => b.close) };
}

function hitStop(bar: IntradayBar, stop: number, isLong: boolean): boolean {
  return isLong ? bar.low <= stop : bar.high >= stop;
}

function hitTarget(bar: IntradayBar, target: number, isLong: boolean): boolean {
  return isLong ? bar.high >= target : bar.low <= target;
}

/**
 * Scaled book simulation. Defaults to 40/40/20 @1/2/3R; pass an exit profile
 * (e.g. stratzy_trend 65/25/10 @0.8R) to match the preset.
 * After T1, stop ratchets to breakeven. Same-bar: stop before target (conservative).
 */
export function simulateScaledTrade(
  forwardBars: IntradayBar[],
  entry: number,
  stop: number,
  targets: number[],
  isLong: boolean,
  profile?: ExitProfile | null,
): { exit: number; outcome: IntradayBacktestTrade['outcome']; r: number; path: string } {
  const risk = Math.abs(entry - stop);
  if (risk <= 0 || targets.length < 1) {
    return { exit: entry, outcome: 'time', r: 0, path: 'invalid' };
  }

  const book = profile ?? resolveExitProfile('as_planned');
  const t1 = targets[0];
  const t2 = targets[1] ?? targets[0];
  const t3 = targets[2] ?? targets[1] ?? targets[0];
  const w = book.weights;
  const rr = book.rr;

  let remaining = 1;
  let realizedR = 0;
  let activeStop = stop;
  let t1Done = false;
  let t2Done = false;
  let lastExit = entry;
  const path: string[] = [];

  for (const bar of forwardBars) {
    const barMin = barMinutesIst(bar);
    if (barMin >= TIME_STOP_MIN) {
      const rClose = isLong ? (bar.close - entry) / risk : (entry - bar.close) / risk;
      realizedR += remaining * rClose;
      lastExit = bar.close;
      path.push('X_TIME');
      remaining = 0;
      break;
    }

    if (hitStop(bar, activeStop, isLong)) {
      const stopR = isLong ? (activeStop - entry) / risk : (entry - activeStop) / risk;
      realizedR += remaining * stopR;
      lastExit = activeStop;
      path.push(t1Done ? 'X1_BE' : 'X1');
      remaining = 0;
      break;
    }

    if (!t1Done && hitTarget(bar, t1, isLong)) {
      realizedR += w[0] * rr[0];
      remaining -= w[0];
      activeStop = entry;
      t1Done = true;
      lastExit = t1;
      path.push('T1');
    }
    if (t1Done && !t2Done && hitTarget(bar, t2, isLong)) {
      realizedR += w[1] * rr[1];
      remaining -= w[1];
      t2Done = true;
      lastExit = t2;
      path.push('T2');
    }
    if (t2Done && remaining > 0 && hitTarget(bar, t3, isLong)) {
      realizedR += remaining * rr[2];
      lastExit = t3;
      path.push('T3');
      remaining = 0;
      break;
    }
  }

  if (remaining > 0) {
    const last = forwardBars[forwardBars.length - 1];
    const exit = last?.close ?? entry;
    const rClose = isLong ? (exit - entry) / risk : (entry - exit) / risk;
    realizedR += remaining * rClose;
    lastExit = exit;
    path.push('X_EOD');
  }

  const r = Math.round(realizedR * 100) / 100;
  const outcome: IntradayBacktestTrade['outcome'] = r > 0.05 ? 'win' : r < -0.05 ? 'loss' : 'time';
  return { exit: lastExit, outcome, r, path: path.join('+') || 'flat' };
}

/** Classic T1-only (+1R/−1R) for parity; prefer simulateScaledTrade for economics. */
export function simulateTrade(
  forwardBars: IntradayBar[],
  entry: number,
  stop: number,
  target: number,
  isLong: boolean,
): { exit: number; outcome: IntradayBacktestTrade['outcome']; r: number } {
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return { exit: entry, outcome: 'time', r: 0 };

  for (const bar of forwardBars) {
    const barMin = barMinutesIst(bar);
    if (barMin >= TIME_STOP_MIN) {
      const r = isLong ? (bar.close - entry) / risk : (entry - bar.close) / risk;
      return { exit: bar.close, outcome: 'time', r: Math.round(r * 100) / 100 };
    }
    if (isLong) {
      if (bar.low <= stop) return { exit: stop, outcome: 'loss', r: -1 };
      if (bar.high >= target) return { exit: target, outcome: 'win', r: 1 };
    } else {
      if (bar.high >= stop) return { exit: stop, outcome: 'loss', r: -1 };
      if (bar.low <= target) return { exit: target, outcome: 'win', r: 1 };
    }
  }

  const last = forwardBars[forwardBars.length - 1];
  const exit = last?.close ?? entry;
  const r = isLong ? (exit - entry) / risk : (entry - exit) / risk;
  return { exit, outcome: 'time', r: Math.round(r * 100) / 100 };
}

function profitFactorFromRs(rs: number[]): number | null {
  if (!rs.length) return null;
  const grossWin = rs.filter((x) => x > 0).reduce((s, x) => s + x, 0);
  const grossLoss = Math.abs(rs.filter((x) => x < 0).reduce((s, x) => s + x, 0));
  if (grossLoss <= 0) return grossWin > 0 ? 99 : 0;
  return Math.round((grossWin / grossLoss) * 100) / 100;
}

function backtestPresetOnSessions(
  presetId: string,
  chart5: IntradayChartSlice,
  chart15: IntradayChartSlice,
  interval: '5m' | '15m',
): IntradayPresetBacktestRow {
  const meta = preset(presetId);
  const opts = presetOptions(presetId);
  const exitProfile = resolveExitProfile(String(opts.exit_profile ?? 'as_planned'));
  const sessions = groupBySession(chart5.bars);
  const trades: IntradayBacktestTrade[] = [];
  const minBars = interval === '5m' ? 50 : 20;
  const maxTrades = Number(opts.max_trades_per_session ?? 2);
  const cooldownBars = Number(opts.cooldown_bars ?? 4);

  for (const [sessionKey, sessionBars] of sessions) {
    let sessionTrades = 0;
    let cooldown = 0;

    for (let i = minBars; i < sessionBars.length - 1; i++) {
      if (cooldown > 0) {
        cooldown -= 1;
        continue;
      }
      if (sessionTrades >= maxTrades) break;

      const gIdx = globalIndex(chart5.bars, sessionBars, i);
      if (gIdx < 0) continue;

      const slice5 = {
        ...chart5,
        bars: chart5.bars.slice(0, gIdx + 1),
        closes: chart5.bars.slice(0, gIdx + 1).map((b) => b.close),
        interval: '5m',
      };
      const bar5 = slice5.bars[slice5.bars.length - 1];
      const slice15 = slice15mUpTo(chart15, bar5);

      const analysis5 = analyzeNiftyDirection(slice5, '5m') as Record<string, unknown>;
      const analysis15 = analyzeNiftyDirection(slice15, '15m') as Record<string, unknown>;
      const active = interval === '5m' ? analysis5 : analysis15;
      const activeChart = interval === '5m' ? slice5 : slice15;

      active.bar_minutes_ist = barMinutesIst(bar5);
      opts.analysis_5m = analysis5;
      opts.analysis_15m = analysis15;

      const plan = buildTradePlan(activeChart.bars, active, {
        exit_profile: exitProfile.id,
      }) as Record<string, unknown>;
      const mtf = mtfConfluence(analysis5, analysis15) as Record<string, unknown>;
      const gate = passes(active, plan, mtf, opts);
      if (!gate.pass) continue;

      const entry = Number((plan.entry as Record<string, unknown> | undefined)?.price ?? active.price ?? 0);
      const stop = Number((plan.stop_loss as Record<string, unknown> | undefined)?.price ?? 0);
      const isLong = String(plan.bias) === 'long';
      if (entry <= 0 || stop <= 0) continue;

      const riskPts = Math.abs(entry - stop);
      const costR = estimateIntradayCostR(entry, riskPts);
      const forward = sessionBars.slice(i + 1);
      const targets = targetsFromProfile(entry, stop, isLong, exitProfile);
      if (targets.length === 0) continue;

      const classic = simulateTrade(forward, entry, stop, targets[0], isLong);
      const sim = simulateScaledTrade(forward, entry, stop, targets, isLong, exitProfile);
      const rGross = sim.r;
      const rNet = Math.round((rGross - costR) * 100) / 100;
      const classicOutcome: IntradayBacktestTrade['outcome'] =
        classic.outcome === 'win' || classic.r > 0.05
          ? 'win'
          : classic.outcome === 'loss' || classic.r < -0.05
            ? 'loss'
            : 'time';
      trades.push({
        session_date: sessionKey,
        entry: Math.round(entry * 100) / 100,
        exit: Math.round(sim.exit * 100) / 100,
        r_multiple: rNet,
        r_gross: rGross,
        r_classic: classic.r,
        cost_r: costR,
        outcome: classicOutcome,
        exit_path: `${exitProfile.id}:${sim.path}`,
      });
      sessionTrades += 1;
      cooldown = cooldownBars;
    }
  }

  const wins = trades.filter((t) => t.outcome === 'win').length;
  const losses = trades.filter((t) => t.outcome === 'loss').length;
  const scaledWins = trades.filter((t) => t.r_gross > 0).length;
  const netWins = trades.filter((t) => t.r_multiple > 0).length;
  const rGrossSum = trades.reduce((s, t) => s + t.r_gross, 0);
  const rNetSum = trades.reduce((s, t) => s + t.r_multiple, 0);
  const rClassicSum = trades.reduce((s, t) => s + t.r_classic, 0);
  const winRate = trades.length > 0 ? Math.round((wins / trades.length) * 1000) / 10 : null;
  const scaledWinRate =
    trades.length > 0 ? Math.round((scaledWins / trades.length) * 1000) / 10 : null;
  const netWinRate =
    trades.length > 0 ? Math.round((netWins / trades.length) * 1000) / 10 : null;
  const expectancyR =
    trades.length > 0 ? Math.round((rGrossSum / trades.length) * 100) / 100 : null;
  const netExpectancyR =
    trades.length > 0 ? Math.round((rNetSum / trades.length) * 100) / 100 : null;
  const classicAvgR =
    trades.length > 0 ? Math.round((rClassicSum / trades.length) * 100) / 100 : null;
  const pfGross = profitFactorFromRs(trades.map((t) => t.r_gross));
  const pf = profitFactorFromRs(trades.map((t) => t.r_multiple));
  const accuracyStatus = intradayAccuracyStatus({ trades: trades.length, win_rate_pct: winRate });
  const economicStatus = intradayEconomicStatus({
    trades: trades.length,
    net_expectancy_r: netExpectancyR,
    profit_factor: pf,
  });

  return {
    preset_id: presetId,
    label: meta?.label ?? presetId,
    sessions: sessions.size,
    trades: trades.length,
    wins,
    losses,
    win_rate_pct: winRate,
    scaled_win_rate_pct: scaledWinRate,
    net_win_rate_pct: netWinRate,
    avg_r: classicAvgR,
    expectancy_r: expectancyR,
    net_expectancy_r: netExpectancyR,
    classic_avg_r: classicAvgR,
    profit_factor: pf,
    profit_factor_gross: pfGross,
    economic_status: economicStatus,
    economic_pass: economicStatus === 'pass',
    accuracy_status: accuracyStatus,
    accuracy_pass: accuracyStatus === 'pass',
    accuracy_floor_pct: MIN_INTRADAY_ACCURACY_PCT,
    min_trades_required: MIN_INTRADAY_TRADES_PROVEN,
    trades_sample: trades.slice(-5),
  };
}

export function backtestIntradayCombo(
  chart5: IntradayChartSlice,
  chart15: IntradayChartSlice,
  options: IntradayBacktestOptions = {},
): IntradayBacktestResult {
  const interval = options.interval === '15m' ? '15m' : '5m';
  const mode = options.mode ?? 'combo_compare';
  const presetList =
    mode === 'single' && options.preset_id
      ? [options.preset_id]
      : presetIds().filter((id) => id !== 'baseline' || mode === 'combo_compare');

  const rows = presetList.map((id) => backtestPresetOnSessions(id, chart5, chart15, interval));
  // Rank by economic edge first (net E → PF), then WR gate.
  const sortedRows = rows.sort(
    (a, b) =>
      Number(b.economic_pass) - Number(a.economic_pass) ||
      (b.net_expectancy_r ?? -99) - (a.net_expectancy_r ?? -99) ||
      (b.profit_factor ?? -1) - (a.profit_factor ?? -1) ||
      Number(b.accuracy_pass) - Number(a.accuracy_pass) ||
      (b.win_rate_pct ?? -1) - (a.win_rate_pct ?? -1),
  );
  const passingPresets = sortedRows.filter((row) => row.accuracy_pass).map((row) => row.preset_id);
  const economicPassing = sortedRows.filter((row) => row.economic_pass).map((row) => row.preset_id);

  return {
    ok: chart5.bars.length >= 50,
    mode,
    interval,
    sessions: groupBySession(chart5.bars).size,
    bars_5m: chart5.bars.length,
    bars_15m: chart15.bars.length,
    presets: sortedRows,
    high_accuracy: {
      floor_pct: MIN_INTRADAY_ACCURACY_PCT,
      strictly_above_floor: true,
      min_trades_required: MIN_INTRADAY_TRADES_PROVEN,
      passing_presets: passingPresets,
      pass_count: passingPresets.length,
    },
    economic: {
      min_expectancy_r: MIN_INTRADAY_EXPECTANCY_R,
      min_profit_factor: MIN_INTRADAY_PROFIT_FACTOR,
      passing_presets: economicPassing,
      pass_count: economicPassing.length,
      best_preset_id: sortedRows[0]?.preset_id ?? null,
    },
    disclaimer:
      `Stratzy Win% uses classic T1-only (+1R/−1R) — same yardstick as before today's scaled upgrade (often mid-40%s; >70% live gate unchanged). Scaled Net E / PF use T1/T2/T3 40/40/20 with BE after T1 and ~${INTRADAY_SIM_SLIPPAGE_BPS_PER_SIDE}bps/side + ₹${INTRADAY_SIM_FLAT_CHARGE_INR} RT on ₹${INTRADAY_SIM_NOTIONAL_INR.toLocaleString('en-IN')}. Economic pass: net E>${MIN_INTRADAY_EXPECTANCY_R}R and PF≥${MIN_INTRADAY_PROFIT_FACTOR}. Past matrix ≠ future returns.`,
  };
}
