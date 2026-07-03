import type { OhlcBar, TaMetrics } from './types.js';
import { evaluateExit } from './evaluate-exit.js';
import { evaluatePositionAction } from './auto-decision.js';

export type PositionInput = {
  id?: string;
  symbol: string;
  status?: string;
  entry_price: number;
  entry_date: string;
  shares?: number | null;
  stop_loss?: number | null;
  profit_target?: number | null;
  highest_since_entry?: number | null;
  trailed_stop_loss?: number | null;
};

export type LivePositionContext = {
  ta: TaMetrics & Record<string, unknown>;
  price: number;
  bars?: OhlcBar[] | null;
  regime?: Record<string, unknown> | null;
};

export function refreshPosition(position: PositionInput, live: LivePositionContext) {
  const price = live.price;
  const entry = position.entry_price;
  const high = Math.max(
    position.highest_since_entry ?? entry,
    price,
    entry,
  );

  const exit = evaluateExit(
    { ...live.ta, as_of_date: live.ta.as_of_date ?? new Date().toISOString().slice(0, 10) },
    price,
    entry,
    position.entry_date,
    null,
    high,
    live.bars ?? null,
    live.bars ?? null,
    position.profit_target ?? null,
    null,
    live.regime ?? null,
    null,
    position.trailed_stop_loss ?? null,
  );

  const row = {
    id: position.id,
    symbol: position.symbol,
    status: position.status ?? 'open',
    entry_price: entry,
    entry_date: position.entry_date,
    shares: position.shares,
    stop_loss: position.stop_loss ?? exit.stop_loss,
    profit_target: position.profit_target ?? exit.profit_target,
    current_price: price,
    gain_pct: exit.gain_pct,
    exit_verdict: exit.verdict,
    exit_triggers: exit.triggered,
    active_stop: exit.active_stop,
    effective_stop: exit.effective_stop,
    breakeven_armed: exit.breakeven_armed,
    trail_armed: exit.trail_armed,
    trail_stop: exit.trail_stop,
    trail_arm_pct: exit.trail_arm_pct,
    trail_from_high_pct: exit.trail_from_high_pct,
    high_water: exit.high_water,
    gain_to_arm_trail_pct: exit.gain_to_arm_trail_pct,
    sessions_held: exit.sessions_held,
    chop_regime: Boolean(live.regime?.sideways),
    position: { id: position.id, entry_price: entry, entry_date: position.entry_date },
    exit,
    ok: price > 0,
  };

  const action = evaluatePositionAction(row, null, live.regime ?? null);
  return {
    ...row,
    position_action: action.action,
    action_label: action.label,
    action_reasons: action.reasons,
    stop_distance_pct: action.stop_distance_pct,
    r_unrealized: action.r_unrealized,
    suggested_trailed_stop: exit.trail_stop ?? exit.active_stop,
    highest_since_entry: high,
  };
}
