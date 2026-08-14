import type { TaMetrics } from './types.js';

export const BIAS_LONG = 'long';
export const BIAS_SHORT = 'short';
export const BIAS_NEUTRAL = 'neutral';

/** Max distance from SMA-20 for a Stratzy pullback entry (%). */
export const SMA20_PULLBACK_PCT = 2.5;
/** Soft hold buffer — price may wick slightly under SMA-20 and still count as above. */
export const SMA20_HOLD_BUFFER = 0.995;

export interface Sma20StratzyState {
  ok: boolean;
  bias: string;
  label: string;
  message: string;
  sma20: number | null;
  price: number | null;
  above: boolean | null;
  near: boolean;
  /** Fresh pullback / reclaim entry zone. */
  entry_ok: boolean;
  /** Structure holds above 20 DMA (may be extended). */
  structure_ok: boolean;
}

/** Daily SMA-20 Stratzy bias for swing E12. */
export function fromTa(ta: TaMetrics, price = 0): Sma20StratzyState {
  let px = price;
  const sma20 = num(ta.ta_sma20);
  if (px <= 0 && num(ta.ta_price)) px = num(ta.ta_price)!;

  if (sma20 === null || sma20 <= 0) {
    return pack(false, BIAS_NEUTRAL, 'SMA-20 warming up', 'Need ≥20 daily bars for SMA-20.', sma20, px || null, null, false, false, false);
  }
  if (px <= 0) {
    return pack(false, BIAS_NEUTRAL, 'Price unavailable', 'No last price for SMA-20 Stratzy gate.', sma20, null, null, false, false, false);
  }

  const above = px >= sma20 * SMA20_HOLD_BUFFER;
  const near = Math.abs(px - sma20) / sma20 * 100 <= SMA20_PULLBACK_PCT;
  const structureOk = above;
  const entryOk = above && near;

  if (px > sma20) {
    return pack(
      true,
      BIAS_LONG,
      entryOk ? '20 MA Stratzy · pullback long' : 'Above SMA-20',
      entryOk
        ? `Price ${px.toFixed(2)} within ${SMA20_PULLBACK_PCT}% of SMA-20 ${sma20.toFixed(2)} — Stratzy pullback entry.`
        : `Price ${px.toFixed(2)} above SMA-20 ${sma20.toFixed(2)} — structure OK; wait for pullback toward 20 DMA.`,
      sma20,
      px,
      true,
      near,
      entryOk,
      structureOk,
    );
  }

  if (px < sma20) {
    return pack(
      true,
      BIAS_SHORT,
      'Below SMA-20',
      `Price ${px.toFixed(2)} below SMA-20 ${sma20.toFixed(2)} — no Stratzy long entry.`,
      sma20,
      px,
      false,
      near,
      false,
      false,
    );
  }

  return pack(
    true,
    BIAS_NEUTRAL,
    'At SMA-20',
    `Price equals SMA-20 ${sma20.toFixed(2)} — wait for reclaim.`,
    sma20,
    px,
    null,
    true,
    false,
    false,
  );
}

export function gateReasons(ta: TaMetrics, price = 0): string[] {
  const state = fromTa(ta, price);
  if (!state.ok) return [state.message];
  if (state.bias === BIAS_SHORT) return ['Long blocked — price below daily SMA-20'];
  if (state.bias === BIAS_NEUTRAL) return ['Price at SMA-20 — no directional bias'];
  if (!state.entry_ok && !state.structure_ok) return ['20 MA Stratzy not aligned'];
  return [];
}

function pack(
  ok: boolean,
  bias: string,
  label: string,
  message: string,
  sma20: number | null,
  price: number | null,
  above: boolean | null,
  near: boolean,
  entryOk: boolean,
  structureOk: boolean,
): Sma20StratzyState {
  return {
    ok,
    bias,
    label,
    message,
    sma20,
    price,
    above,
    near,
    entry_ok: entryOk,
    structure_ok: structureOk,
  };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
