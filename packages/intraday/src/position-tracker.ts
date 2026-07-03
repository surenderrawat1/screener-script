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
