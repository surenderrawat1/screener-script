import type { TaMetrics } from './types.js';

export const BIAS_LONG = 'long';
export const BIAS_SHORT = 'short';
export const BIAS_NEUTRAL = 'neutral';

export interface Gc9State {
  ok: boolean;
  bias: string;
  label: string;
  message: string;
  sma9: number | null;
  sma50: number | null;
  gc9_active: boolean;
  dc9_active: boolean;
  cross_time: string | null;
  entry_ok: boolean;
  gc9_entry: boolean;
}

export function fromTa(ta: TaMetrics, price = 0): Gc9State {
  let px = price;
  const sma9 = num(ta.ta_sma9);
  const sma50 = num(ta.ta_sma50);
  const gc9 = Boolean(ta.ta_golden_cross_9_50);
  const dc9 = Boolean(ta.ta_death_cross_9_50);
  const crossTime = ta.ta_cross_9_50_time ? String(ta.ta_cross_9_50_time) : null;

  if (px <= 0 && num(ta.ta_price)) px = num(ta.ta_price)!;

  if (sma9 === null || sma50 === null || sma50 <= 0) {
    return pack(false, BIAS_NEUTRAL, 'SMA warming up', 'Need ≥50 daily bars for SMA-9/50.', sma9, sma50, gc9, dc9, crossTime, false, false);
  }

  if (sma9 > sma50) {
    const aboveFast = px <= 0 || px >= sma9 * 0.995;
    const entryOk = aboveFast && !dc9;
    const gc9Entry = gc9 && entryOk;
    const timeNote = gc9 && crossTime ? ` · cross ${crossTime}` : '';
    return pack(
      true,
      BIAS_LONG,
      gc9 ? 'GC9 · swing long' : 'SMA-9 > SMA-50',
      `Daily SMA-9 ${sma9.toFixed(2)} above SMA-50 ${sma50.toFixed(2)}${timeNote} — ${gc9Entry ? 'fresh GC9 entry zone.' : entryOk ? 'bullish structure — hold above SMA-9.' : 'wait for price above SMA-9.'}`,
      sma9,
      sma50,
      gc9,
      dc9,
      crossTime,
      entryOk,
      gc9Entry,
    );
  }

  if (sma9 < sma50) {
    const timeNote = dc9 && crossTime ? ` · cross ${crossTime}` : '';
    return pack(
      true,
      BIAS_SHORT,
      dc9 ? 'DC9 · avoid longs' : 'SMA-9 < SMA-50',
      `Daily SMA-9 ${sma9.toFixed(2)} below SMA-50 ${sma50.toFixed(2)}${timeNote} — no GC9 long entry.`,
      sma9,
      sma50,
      gc9,
      dc9,
      crossTime,
      false,
      false,
    );
  }

  return pack(true, BIAS_NEUTRAL, 'SMA-9 at SMA-50', 'Daily SMA-9 equals SMA-50 — wait for side to clear.', sma9, sma50, gc9, dc9, crossTime, false, false);
}

export function gateReasons(ta: TaMetrics, price = 0): string[] {
  const state = fromTa(ta, price);
  if (!state.ok) return [state.message];
  if (state.dc9_active && state.bias !== BIAS_LONG) return ['DC9 active — recent SMA-9/50 death cross'];
  if (state.bias === BIAS_SHORT) return ['Long blocked — daily SMA-9 below SMA-50'];
  if (state.bias === BIAS_NEUTRAL) return ['SMA-9 at SMA-50 — no directional bias'];
  if (!state.gc9_entry && !state.entry_ok) return ['GC9 structure not aligned — need price above SMA-9'];
  return [];
}

function pack(
  ok: boolean,
  bias: string,
  label: string,
  message: string,
  sma9: number | null,
  sma50: number | null,
  gc9: boolean,
  dc9: boolean,
  crossTime: string | null,
  entryOk: boolean,
  gc9Entry: boolean,
): Gc9State {
  return { ok, bias, label, message, sma9, sma50, gc9_active: gc9, dc9_active: dc9, cross_time: crossTime, entry_ok: entryOk, gc9_entry: gc9Entry };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
