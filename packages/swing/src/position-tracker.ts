import type { OhlcBar, TaMetrics } from './types.js';
import { evaluateExit, trailFromHighPct } from './evaluate-exit.js';
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
  hourlyBars?: OhlcBar[] | null;
  regime?: Record<string, unknown> | null;
};

/** Maximum confirmed daily-bar high on/after the entry date. */
function maxBarHighSinceEntry(bars: OhlcBar[] | null | undefined, entryDate: string): number {
  if (!bars?.length || !entryDate) return 0;
  const entryDay = entryDate.slice(0, 10);
  let high = 0;
  for (const bar of bars) {
    if (bar.time.slice(0, 10) >= entryDay) high = Math.max(high, bar.high);
  }
  return high;
}

/**
 * High-water mark since entry.
 *
 * Confirmed daily bar highs (plus the current live price) are authoritative. A
 * persisted high-water that sits above every confirmed bar high is a stale or
 * bad-tick live quote — trusting it would permanently inflate the trailing stop
 * and force false exits — so it is discarded whenever bars are available.
 * The stored value is used only as a fallback when no bars can be loaded.
 */
export function highWaterSinceEntry(
  bars: OhlcBar[] | null | undefined,
  entryDate: string,
  storedHwm: number | null | undefined,
  entry: number,
  price: number,
): number {
  const barHigh = maxBarHighSinceEntry(bars, entryDate);
  if (barHigh > 0) {
    return Math.round(Math.max(barHigh, price, entry) * 100) / 100;
  }
  return Math.round(Math.max(storedHwm ?? entry, price, entry) * 100) / 100;
}

export function refreshPosition(position: PositionInput, live: LivePositionContext) {
  const price = live.price;
  const entry = position.entry_price;
  const high = highWaterSinceEntry(
    live.bars,
    position.entry_date,
    position.highest_since_entry,
    entry,
    price,
  );

  // Cap a persisted trail floor at the trail the authoritative high justifies.
  // A floor ratcheted from a prior bad-tick high-water would otherwise keep the
  // trailing stop inflated (and fire false exits) forever; fresh EMA-9 trailing
  // is still applied inside evaluateExit.
  const fromHighPct = trailFromHighPct(live.regime ?? null);
  const justifiedTrailFloor = Math.round(high * (1 - fromHighPct / 100) * 100) / 100;
  const storedFloor = position.trailed_stop_loss ?? null;
  const cappedFloor = storedFloor != null ? Math.min(storedFloor, justifiedTrailFloor) : null;

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
    live.hourlyBars ?? null,
    cappedFloor,
  );

  const chopRegime = Boolean(live.regime?.sideways || live.regime?.chop);

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
    chop_regime: chopRegime,
    position: { id: position.id, entry_price: entry, entry_date: position.entry_date },
    exit,
    ok: price > 0,
  };

  const action = evaluatePositionAction(row, null, live.regime ?? null);
  const suggestedTrail = exit.trail_stop ?? exit.active_stop;
  const ratchetTrail =
    suggestedTrail != null && cappedFloor != null
      ? Math.max(suggestedTrail, cappedFloor)
      : suggestedTrail;

  return {
    ...row,
    position_action: action.action,
    action_label: action.label,
    action_reasons: action.reasons,
    stop_distance_pct: action.stop_distance_pct,
    r_unrealized: action.r_unrealized,
    suggested_trailed_stop: ratchetTrail,
    highest_since_entry: high,
  };
}

export type TrailRatchetUpdate = {
  highest_since_entry?: number;
  trailed_stop_loss?: number;
};

/**
 * Returns DB fields to persist after a live refresh.
 *
 * The high-water mark ratchets up normally but is also corrected *down* when the
 * authoritative (bar-confirmed) recomputation is lower than the stored value —
 * this self-heals a high-water that was inflated by a stale/bad-tick live quote.
 * The trailing stop remains up-only so a genuine trail never loosens.
 */
export function trailRatchetFields(
  position: PositionInput,
  refreshed: { highest_since_entry?: number; suggested_trailed_stop?: number | null },
): TrailRatchetUpdate {
  const out: TrailRatchetUpdate = {};
  const newHwm = refreshed.highest_since_entry;
  const oldHwm = position.highest_since_entry ?? position.entry_price;
  if (newHwm != null && newHwm !== oldHwm) out.highest_since_entry = newHwm;

  const newTrail = refreshed.suggested_trailed_stop;
  const oldTrail = position.trailed_stop_loss ?? 0;
  if (newTrail != null && newTrail > oldTrail) out.trailed_stop_loss = newTrail;

  return out;
}
