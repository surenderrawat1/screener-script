import { barMinutesIst, TIME_STOP_MIN } from './session-clock.js';
import { normalizeInterval } from './nifty-direction.js';

export type IntradayBar = {
  close: number;
  high?: number;
  low?: number;
  time_label?: string;
};

export type IntradayPositionInput = Record<string, unknown>;

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
  const barMin = barMinutesIst(last);

  const gainPct = isLong ? ((price - entry) / entry) * 100 : ((entry - price) / entry) * 100;
  const qty = Number(position.quantity ?? 0);
  const pnl = qty > 0 ? Math.round((isLong ? price - entry : entry - price) * qty * 100) / 100 : null;

  const triggers: string[] = [];
  let verdict = 'HOLD';
  let action = 'HOLD';
  let actionLabel = 'Hold — plan intact';

  if (stop > 0) {
    const stopped = isLong ? price <= stop : price >= stop;
    if (stopped) {
      triggers.push(`Hard stop @ ₹${stop.toFixed(2)}`);
      verdict = 'EXIT';
      action = 'EXIT_NOW';
      actionLabel = 'Exit now — stop hit';
    }
  }

  if (verdict !== 'EXIT' && t1 > 0) {
    const t1Hit = isLong ? price >= t1 : price <= t1;
    if (t1Hit && !position.t1_booked) {
      triggers.push(`T1 @ ₹${t1.toFixed(2)} — book 40%, move stop to BE`);
      action = 'PARTIAL_T1';
      actionLabel = 'Book T1 partial · move stop to breakeven';
    }
  }

  if (verdict !== 'EXIT' && t2 > 0 && position.t1_booked) {
    const t2Hit = isLong ? price >= t2 : price <= t2;
    if (t2Hit && !position.t2_booked) {
      triggers.push(`T2 @ ₹${t2.toFixed(2)} — book 40%, trail remainder`);
      action = 'PARTIAL_T2';
      actionLabel = 'Book T2 partial · trail runner';
    }
  }

  if (verdict !== 'EXIT' && t3 > 0 && remaining > 0) {
    const t3Hit = isLong ? price >= t3 : price <= t3;
    if (t3Hit) {
      triggers.push(`T3 @ ₹${t3.toFixed(2)} — final target`);
      verdict = 'EXIT';
      action = 'EXIT_TARGET';
      actionLabel = 'Exit — final target reached';
    }
  }

  if (verdict !== 'EXIT' && barMin >= TIME_STOP_MIN) {
    triggers.push(`Time stop ${String(Math.floor(TIME_STOP_MIN / 60)).padStart(2, '0')}:${String(TIME_STOP_MIN % 60).padStart(2, '0')} IST`);
    verdict = 'EXIT';
    action = 'EXIT_TIME';
    actionLabel = 'Exit — session time stop';
  }

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
