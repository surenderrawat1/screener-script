import { barMinutesIst, TIME_STOP_MIN } from './session-clock.js';
import { analyze as analyzeNiftyDirection, type IntradayBar } from './nifty-direction.js';
import { buildTradePlan } from './trade-plan.js';
import { confluence as mtfConfluence } from './mtf.js';
import { passes, preset, presetIds, presetOptions } from './entry-filter.js';

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
  outcome: 'win' | 'loss' | 'time';
}

export interface IntradayPresetBacktestRow {
  preset_id: string;
  label: string;
  sessions: number;
  trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number | null;
  avg_r: number | null;
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
  disclaimer: string;
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

function simulateTrade(
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

function backtestPresetOnSessions(
  presetId: string,
  chart5: IntradayChartSlice,
  chart15: IntradayChartSlice,
  interval: '5m' | '15m',
): IntradayPresetBacktestRow {
  const meta = preset(presetId);
  const opts = presetOptions(presetId);
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
      if (interval === '5m') {
        opts.analysis_5m = analysis5;
      }

      const plan = buildTradePlan(activeChart.bars, active) as Record<string, unknown>;
      const mtf = mtfConfluence(analysis5, analysis15) as Record<string, unknown>;
      const gate = passes(active, plan, mtf, opts);
      if (!gate.pass) continue;

      const entry = Number((plan.entry as Record<string, unknown> | undefined)?.price ?? active.price ?? 0);
      const stop = Number((plan.stop_loss as Record<string, unknown> | undefined)?.price ?? 0);
      const exits = (plan.exits as Array<Record<string, unknown>>) ?? [];
      const target = Number(exits[0]?.price ?? 0);
      const isLong = String(plan.bias) === 'long';
      if (entry <= 0 || stop <= 0 || target <= 0) continue;

      const forward = sessionBars.slice(i + 1);
      const sim = simulateTrade(forward, entry, stop, target, isLong);
      trades.push({
        session_date: sessionKey,
        entry: Math.round(entry * 100) / 100,
        exit: Math.round(sim.exit * 100) / 100,
        r_multiple: sim.r,
        outcome: sim.outcome,
      });
      sessionTrades += 1;
      cooldown = cooldownBars;
    }
  }

  const wins = trades.filter((t) => t.r_multiple > 0).length;
  const losses = trades.filter((t) => t.r_multiple < 0).length;
  const rSum = trades.reduce((s, t) => s + t.r_multiple, 0);

  return {
    preset_id: presetId,
    label: meta?.label ?? presetId,
    sessions: sessions.size,
    trades: trades.length,
    wins,
    losses,
    win_rate_pct: trades.length > 0 ? Math.round((wins / trades.length) * 1000) / 10 : null,
    avg_r: trades.length > 0 ? Math.round((rSum / trades.length) * 100) / 100 : null,
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

  return {
    ok: chart5.bars.length >= 50,
    mode,
    interval,
    sessions: groupBySession(chart5.bars).size,
    bars_5m: chart5.bars.length,
    bars_15m: chart15.bars.length,
    presets: rows.sort((a, b) => (b.avg_r ?? -99) - (a.avg_r ?? -99)),
    disclaimer:
      'Simulated fills at plan levels — no slippage, charges, or partial exits. Educational research only.',
  };
}
