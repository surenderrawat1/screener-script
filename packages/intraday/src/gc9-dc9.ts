export const BIAS_LONG = 'long';
export const BIAS_SHORT = 'short';
export const BIAS_NEUTRAL = 'neutral';

export function fromAnalysis(analysis5: Record<string, unknown>) {
  if (!analysis5.ok) {
    return pack(false, BIAS_NEUTRAL, '5m unavailable', '5m chart not ready for GC9/DC9 filter.', null, null, false, false, null);
  }
  const sma9 = num(analysis5.sma9);
  const sma50 = num(analysis5.sma50);
  const gc9 = Boolean(analysis5.gc9_active);
  const dc9 = Boolean(analysis5.dc9_active);
  const crossTime = analysis5.cross_9_50_time ? String(analysis5.cross_9_50_time) : null;

  if (sma9 === null || sma50 === null || sma50 <= 0) {
    return pack(false, BIAS_NEUTRAL, 'SMA warming up', 'Need ≥50 five-minute bars for SMA-9/50.', sma9, sma50, gc9, dc9, crossTime);
  }
  if (sma9 > sma50) {
    const timeNote = gc9 && crossTime ? ` · cross ${crossTime}` : '';
    return pack(true, BIAS_LONG, gc9 ? 'GC9 · long only' : 'SMA-9 > SMA-50 · long only', `5m SMA-9 ${sma9.toFixed(2)} above SMA-50 ${sma50.toFixed(2)}${timeNote} — take long setups only.`, sma9, sma50, gc9, dc9, crossTime);
  }
  if (sma9 < sma50) {
    const timeNote = dc9 && crossTime ? ` · cross ${crossTime}` : '';
    return pack(true, BIAS_SHORT, dc9 ? 'DC9 · short only' : 'SMA-9 < SMA-50 · short only', `5m SMA-9 ${sma9.toFixed(2)} below SMA-50 ${sma50.toFixed(2)}${timeNote} — take short setups only.`, sma9, sma50, gc9, dc9, crossTime);
  }
  return pack(true, BIAS_NEUTRAL, 'SMA-9 at SMA-50', '5m SMA-9 equals SMA-50 — stand aside until side is clear.', sma9, sma50, gc9, dc9, crossTime);
}

export function gateReasons(analysis5: Record<string, unknown> | null | undefined, planBias: string): string[] {
  if (!['long', 'short'].includes(planBias)) return [];
  if (!analysis5) return ['5m GC9/DC9 filter — 5m data unavailable'];
  const state = fromAnalysis(analysis5);
  if (!state.ok) return [state.message];
  if (state.bias === BIAS_NEUTRAL) return ['5m SMA-9 at SMA-50 — no directional bias'];
  if (planBias === 'long' && state.bias !== BIAS_LONG) {
    return [`Long blocked — 5m SMA-9 below SMA-50 (${(state.sma50 ?? 0).toFixed(2)})`];
  }
  if (planBias === 'short' && state.bias !== BIAS_SHORT) {
    return [`Short blocked — 5m SMA-9 above SMA-50 (${(state.sma50 ?? 0).toFixed(2)})`];
  }
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
) {
  return { ok, bias, label, message, sma9, sma50, gc9_active: gc9, dc9_active: dc9, cross_time: crossTime };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
