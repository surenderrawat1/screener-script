import { barMinutesIst, formatMinutes, TIME_STOP_MIN } from './session-clock.js';
import { normalizeInterval } from './nifty-direction.js';

export type IntradayBar = {
  close: number;
  high?: number;
  low?: number;
  time_label?: string;
  /** Yahoo bar open (unix seconds) — used to filter bars since entry. */
  time?: number;
};

export type IntradayPositionInput = Record<string, unknown>;

function hitStop(bar: IntradayBar, stop: number, isLong: boolean): boolean {
  if (stop <= 0) return false;
  const high = Number(bar.high ?? bar.close);
  const low = Number(bar.low ?? bar.close);
  return isLong ? low <= stop : high >= stop;
}

function hitTarget(bar: IntradayBar, target: number, isLong: boolean): boolean {
  if (target <= 0) return false;
  const high = Number(bar.high ?? bar.close);
  const low = Number(bar.low ?? bar.close);
  return isLong ? high >= target : low <= target;
}

/** Bars from entry bar onward — matches backtest forward walk (not last-bar-only). */
export function forwardBarsSinceEntry(
  bars: IntradayBar[],
  entryTime?: string | Date | null,
): IntradayBar[] {
  if (!entryTime || bars.length === 0) return bars;
  const entryUnix = Math.floor(new Date(entryTime).getTime() / 1000);
  const padSec = 15 * 60;
  const filtered = bars.filter((bar) => {
    if (bar.time != null) return bar.time >= entryUnix - padSec;
    const barMin = barMinutesIst(bar);
    const entryMin = barMinutesIst({ time_label: istLabelFromDate(entryTime) });
    return barMin === 0 || entryMin === 0 || barMin >= entryMin;
  });
  return filtered.length > 0 ? filtered : bars;
}

function istLabelFromDate(value: string | Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/**
 * Walk session bars since entry and return the next live action (partials, exit, hold).
 * Aligns paper ticks with scaled-book backtest — a T1 touch on any prior bar is not missed.
 */
export function walkIntradayPositionActions(
  position: IntradayPositionInput,
  bars: IntradayBar[],
): {
  action: string;
  verdict: string;
  actionLabel: string;
  triggers: string[];
  simT1Booked: boolean;
  simT2Booked: boolean;
} {
  const side = String(position.side ?? 'long').toLowerCase() === 'short' ? 'short' : 'long';
  const isLong = side === 'long';
  const entry = Number(position.entry_price ?? 0);
  const stop = Number(position.effective_stop ?? position.stop_loss ?? 0);
  const t1 = Number(position.target_t1 ?? 0);
  const t2 = Number(position.target_t2 ?? 0);
  const t3 = Number(position.target_t3 ?? 0);
  const t1Pct = Number(position.t1_book_pct ?? 40);
  const t2Pct = Number(position.t2_book_pct ?? 40);
  const dbT1 = Boolean(position.t1_booked);
  const dbT2 = Boolean(position.t2_booked);

  let activeStop = stop;
  let simT1 = dbT1;
  let simT2 = dbT2;
  let action = 'HOLD';
  let verdict = 'HOLD';
  let actionLabel = 'Hold — plan intact';
  const triggers: string[] = [];

  const forward = forwardBarsSinceEntry(bars, String(position.entry_time ?? '') || null);

  for (const bar of forward) {
    const barMin = barMinutesIst(bar);

    if (activeStop > 0 && hitStop(bar, activeStop, isLong)) {
      triggers.push(`Hard stop @ ₹${activeStop.toFixed(2)}`);
      verdict = 'EXIT';
      action = 'EXIT_NOW';
      actionLabel = 'Exit now — stop hit';
      break;
    }

    if (t1 > 0 && !simT1 && hitTarget(bar, t1, isLong)) {
      simT1 = true;
      activeStop = entry;
      if (!dbT1) {
        triggers.push(`T1 @ ₹${t1.toFixed(2)} — book ${t1Pct}%, move stop to BE`);
        action = 'PARTIAL_T1';
        actionLabel = `Book T1 ${t1Pct}% · move stop to breakeven`;
        break;
      }
    }

    if (t2 > 0 && simT1 && !simT2 && hitTarget(bar, t2, isLong)) {
      simT2 = true;
      if (!dbT2) {
        triggers.push(`T2 @ ₹${t2.toFixed(2)} — book ${t2Pct}%, trail remainder`);
        action = 'PARTIAL_T2';
        actionLabel = `Book T2 ${t2Pct}% · trail runner`;
        break;
      }
    }

    if (t3 > 0 && simT2 && hitTarget(bar, t3, isLong)) {
      triggers.push(`T3 @ ₹${t3.toFixed(2)} — final target (close remainder)`);
      verdict = 'EXIT';
      action = 'EXIT_TARGET';
      actionLabel = 'Exit — T3 final target reached';
      break;
    }

    if (barMin >= TIME_STOP_MIN) {
      triggers.push(`Time stop ${formatMinutes(TIME_STOP_MIN)} IST`);
      verdict = 'EXIT';
      action = 'EXIT_TIME';
      actionLabel = 'Exit — session time stop';
      break;
    }
  }

  return { action, verdict, actionLabel, triggers, simT1Booked: simT1, simT2Booked: simT2 };
}

const EXIT_ACTIONS = new Set(['EXIT_NOW', 'EXIT_TIME', 'EXIT_TARGET', 'CUT_LOSS']);

function actionRank(action: string): number {
  if (['EXIT_NOW', 'EXIT_TIME', 'EXIT_TARGET'].includes(action)) return 0;
  if (['PARTIAL_T1', 'PARTIAL_T2', 'TIGHTEN_STOP'].includes(action)) return 1;
  return 2;
}

export function evaluateIntradayPosition(
  position: IntradayPositionInput,
  bars: IntradayBar[],
): Record<string, unknown> {
  const instrumentId = String(position.instrument_id ?? '');
  const side = String(position.side ?? 'long').toLowerCase() === 'short' ? 'short' : 'long';
  const isLong = side === 'long';
  const timeframe = normalizeInterval(String(position.timeframe ?? '15m'));
  const entry = Number(position.entry_price ?? 0);

  const base: Record<string, unknown> = {
    position,
    instrument_id: instrumentId,
    instrument_label: String(position.instrument_label ?? instrumentId),
    ok: false,
    error: null,
    current_price: null,
    as_of: null,
    gain_pct: null,
    pnl_inr: null,
    exit_verdict: 'HOLD',
    position_action: 'HOLD',
    action_label: 'Hold',
    exit_triggers: [] as string[],
    symbol: String(position.symbol ?? ''),
    timeframe,
  };

  if (instrumentId === '' || entry <= 0) {
    base.error = 'Invalid position record.';
    return base;
  }

  if (bars.length === 0) {
    base.error = `No intraday chart for ${base.instrument_label}.`;
    return base;
  }

  const last = bars[bars.length - 1];
  const price = Number(last.close ?? 0);
  const asOf = String(last.time_label ?? '');
  if (price <= 0) {
    base.error = 'No live price on chart.';
    return base;
  }

  const stop = Number(position.effective_stop ?? position.stop_loss ?? 0);
  const t1 = Number(position.target_t1 ?? 0);
  const t2 = Number(position.target_t2 ?? 0);
  const t3 = Number(position.target_t3 ?? 0);
  const remaining = Number(position.remaining_pct ?? 100);

  const gainPct = isLong ? ((price - entry) / entry) * 100 : ((entry - price) / entry) * 100;
  const qty = Number(position.quantity ?? 0);
  const pnl = qty > 0 ? Math.round((isLong ? price - entry : entry - price) * qty * 100) / 100 : null;

  const walked = walkIntradayPositionActions(position, bars);
  let verdict = walked.verdict;
  let action = walked.action;
  let actionLabel = walked.actionLabel;
  const triggers = walked.triggers;

  if (verdict === 'HOLD' && action === 'HOLD' && stop > 0) {
    const initialStop = Number(position.stop_loss ?? stop);
    const risk = Math.abs(entry - initialStop);
    if (risk > 0 && gainPct >= (risk / entry) * 100 * 0.95 && !position.breakeven_armed) {
      action = 'TIGHTEN_STOP';
      actionLabel = 'Near 1R — consider breakeven stop';
      triggers.push('Unrealized ≥ ~1R — arm breakeven');
    }
  }

  return {
    ...base,
    side,
    side_label: isLong ? 'Long' : 'Short',
    ok: true,
    error: null,
    current_price: Math.round(price * 100) / 100,
    as_of: asOf,
    gain_pct: Math.round(gainPct * 100) / 100,
    pnl_inr: pnl,
    remaining_pct: remaining,
    stop_loss: position.stop_loss ?? null,
    effective_stop: stop > 0 ? Math.round(stop * 100) / 100 : null,
    target_t1: t1 > 0 ? Math.round(t1 * 100) / 100 : null,
    target_t2: t2 > 0 ? Math.round(t2 * 100) / 100 : null,
    target_t3: t3 > 0 ? Math.round(t3 * 100) / 100 : null,
    exit_verdict: verdict,
    position_action: action,
    action_label: actionLabel,
    exit_triggers: triggers,
    data_source: `yahoo_intraday_${timeframe}`,
  };
}

export function sortTrackedPositions(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const va = actionRank(String(a.position_action ?? ''));
    const vb = actionRank(String(b.position_action ?? ''));
    if (va !== vb) return va - vb;
    return String(a.instrument_label ?? '').localeCompare(String(b.instrument_label ?? ''));
  });
}

export function countIntradayExitSignals(rows: Record<string, unknown>[]): number {
  return rows.filter((row) => String(row.exit_verdict ?? '') === 'EXIT').length;
}

export function isUrgentIntradayAction(row: Record<string, unknown>): boolean {
  const act = String(row.position_action ?? 'HOLD');
  return EXIT_ACTIONS.has(act) || String(row.exit_verdict ?? '') === 'EXIT';
}

export function serializeTrackedIntradayPosition(row: Record<string, unknown>) {
  const pos = (row.position as Record<string, unknown> | undefined) ?? row;
  return {
    id: String(pos.id ?? row.id ?? ''),
    instrument_id: String(row.instrument_id ?? pos.instrument_id ?? ''),
    instrument_label: String(row.instrument_label ?? pos.instrument_label ?? ''),
    symbol: String(row.symbol ?? pos.symbol ?? ''),
    status: String(pos.status ?? row.status ?? 'open'),
    side: String(row.side ?? pos.side ?? 'long'),
    side_label: String(row.side_label ?? (pos.side === 'short' ? 'Short' : 'Long')),
    timeframe: String(row.timeframe ?? pos.timeframe ?? '15m'),
    entry_price: Number(pos.entry_price ?? row.entry_price ?? 0),
    entry_time: String(pos.entry_time ?? ''),
    session_date: String(pos.session_date ?? ''),
    quantity: pos.quantity ?? row.quantity ?? null,
    notes: pos.notes ?? null,
    source: pos.source ?? null,
    ok: row.ok !== false && row.current_price != null,
    error: row.error != null ? String(row.error) : null,
    current_price: typeof row.current_price === 'number' ? row.current_price : null,
    as_of: row.as_of ?? null,
    gain_pct: typeof row.gain_pct === 'number' ? row.gain_pct : null,
    pnl_inr: typeof row.pnl_inr === 'number' ? row.pnl_inr : null,
    exit_verdict: String(row.exit_verdict ?? 'HOLD'),
    position_action: String(row.position_action ?? 'HOLD'),
    action_label: String(row.action_label ?? 'Hold'),
    exit_triggers: Array.isArray(row.exit_triggers) ? row.exit_triggers.map(String) : [],
    stop_loss: row.stop_loss ?? pos.stop_loss ?? null,
    effective_stop: row.effective_stop ?? pos.effective_stop ?? null,
    target_t1: row.target_t1 ?? pos.target_t1 ?? null,
    target_t2: row.target_t2 ?? pos.target_t2 ?? null,
    target_t3: row.target_t3 ?? pos.target_t3 ?? null,
    remaining_pct: Number(row.remaining_pct ?? pos.remaining_pct ?? 100),
    t1_booked: Boolean(pos.t1_booked),
    t2_booked: Boolean(pos.t2_booked),
    breakeven_armed: Boolean(pos.breakeven_armed),
    closed_at: pos.closed_at ?? null,
    closed_price: pos.closed_price ?? null,
    closed_reason: pos.closed_reason ?? null,
    data_source: row.data_source ?? null,
  };
}

export function summarizeOpenIntradayPortfolio(rows: Record<string, unknown>[]) {
  let netPnl = 0;
  let pnlCount = 0;
  for (const row of rows) {
    const pnl = row.pnl_inr;
    if (typeof pnl === 'number' && Number.isFinite(pnl)) {
      netPnl += pnl;
      pnlCount += 1;
    }
  }
  return {
    count: rows.length,
    pnl_count: pnlCount,
    net_pnl_inr: pnlCount > 0 ? Math.round(netPnl * 100) / 100 : null,
    exit_count: countIntradayExitSignals(rows),
    urgent_count: rows.filter(isUrgentIntradayAction).length,
  };
}

export function closedTradeMetrics(pos: Record<string, unknown>) {
  const entry = Number(pos.entry_price ?? 0);
  const exit = Number(pos.closed_price ?? 0);
  const qty = Number(pos.quantity ?? 0) || 1;
  const side = String(pos.side ?? 'long');
  if (entry <= 0 || exit <= 0) return null;

  const gross = side === 'short' ? (entry - exit) * qty : (exit - entry) * qty;
  const stop = Number(pos.stop_loss ?? 0);
  let rMultiple: number | null = null;
  if (stop > 0) {
    const risk = Math.abs(entry - stop);
    if (risk > 0) {
      const pts = side === 'short' ? entry - exit : exit - entry;
      rMultiple = Math.round((pts / risk) * 100) / 100;
    }
  }

  return {
    net_pnl: Math.round(gross * 100) / 100,
    net_pnl_pct: Math.round(((side === 'short' ? entry - exit : exit - entry) / entry) * 10000) / 100,
    r_multiple: rMultiple,
  };
}

export function summarizeClosedIntradayPositions(closed: Record<string, unknown>[]) {
  let wins = 0;
  let losses = 0;
  let netSum = 0;
  let withPnl = 0;
  let rSum = 0;
  let rCount = 0;
  let best: { instrument: string; net_pnl: number; r_multiple: number | null } | null = null;
  let worst: { instrument: string; net_pnl: number; r_multiple: number | null } | null = null;

  for (const pos of closed) {
    const m = closedTradeMetrics(pos);
    if (!m) continue;
    withPnl += 1;
    netSum += m.net_pnl;
    if (m.net_pnl >= 0) wins += 1;
    else losses += 1;
    if (m.r_multiple != null) {
      rSum += m.r_multiple;
      rCount += 1;
    }
    const label = String(pos.instrument_label ?? pos.instrument_id ?? '');
    if (!best || m.net_pnl > best.net_pnl) {
      best = { instrument: label, net_pnl: m.net_pnl, r_multiple: m.r_multiple };
    }
    if (!worst || m.net_pnl < worst.net_pnl) {
      worst = { instrument: label, net_pnl: m.net_pnl, r_multiple: m.r_multiple };
    }
  }

  return {
    with_pnl: withPnl,
    wins,
    losses,
    win_rate_pct: withPnl > 0 ? Math.round((wins / withPnl) * 1000) / 10 : null,
    avg_r: rCount > 0 ? Math.round((rSum / rCount) * 100) / 100 : null,
    r_count: rCount,
    total_net_pnl: Math.round(netSum * 100) / 100,
    best,
    worst,
  };
}
