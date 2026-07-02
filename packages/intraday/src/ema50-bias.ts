export const BIAS_LONG = 'long';
export const BIAS_SHORT = 'short';
export const BIAS_NEUTRAL = 'neutral';

export function fromAnalysis(analysis5: Record<string, unknown>) {
  if (!analysis5.ok) {
    return pack(false, BIAS_NEUTRAL, '5m unavailable', '5m chart not ready for EMA-50 filter.', null, null, null);
  }
  const price = num(analysis5.price);
  const ema50 = num(analysis5.ema50);
  if (price === null || price <= 0 || ema50 === null || ema50 <= 0) {
    return pack(false, BIAS_NEUTRAL, 'EMA-50 warming up', 'Need ≥50 five-minute bars for EMA-50.', price, ema50, null);
  }
  if (price > ema50) {
    return pack(true, BIAS_LONG, '5m above EMA-50 · long only', `Price ${price.toFixed(2)} above 5m EMA-50 ${ema50.toFixed(2)} — take long setups only.`, price, ema50, true);
  }
  if (price < ema50) {
    return pack(true, BIAS_SHORT, '5m below EMA-50 · short only', `Price ${price.toFixed(2)} below 5m EMA-50 ${ema50.toFixed(2)} — take short setups only.`, price, ema50, false);
  }
  return pack(true, BIAS_NEUTRAL, '5m at EMA-50', 'Price equals 5m EMA-50 — stand aside until side is clear.', price, ema50, null);
}

export function gateReasons(analysis5: Record<string, unknown> | null | undefined, planBias: string): string[] {
  if (!['long', 'short'].includes(planBias)) return [];
  if (!analysis5) return ['5m EMA-50 filter — 5m data unavailable'];
  const state = fromAnalysis(analysis5);
  if (!state.ok) return [state.message];
  if (state.bias === BIAS_NEUTRAL) return ['Price at 5m EMA-50 — no directional bias'];
  if (planBias === 'long' && state.bias !== BIAS_LONG) {
    return [`Long blocked — price below 5m EMA-50 (${(state.ema50 ?? 0).toFixed(2)})`];
  }
  if (planBias === 'short' && state.bias !== BIAS_SHORT) {
    return [`Short blocked — price above 5m EMA-50 (${(state.ema50 ?? 0).toFixed(2)})`];
  }
  return [];
}

function pack(
  ok: boolean,
  bias: string,
  label: string,
  message: string,
  price: number | null,
  ema50: number | null,
  above: boolean | null,
) {
  return { ok, bias, label, message, price, ema50, above };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
