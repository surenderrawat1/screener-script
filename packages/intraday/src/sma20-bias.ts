export const BIAS_LONG = 'long';
export const BIAS_SHORT = 'short';
export const BIAS_NEUTRAL = 'neutral';

/** Max distance from SMA-20 as % of price — blocks chase entries (Stratzy). */
export const DEFAULT_MAX_SMA20_EXTENSION_PCT = 0.45;

/** Stratzy 20 MA bias — price vs SMA-20 on the active 5m chart. */
export function fromAnalysis(analysis5: Record<string, unknown>) {
  if (!analysis5.ok) {
    return pack(false, BIAS_NEUTRAL, '5m unavailable', '5m chart not ready for SMA-20 filter.', null, null, null, null);
  }
  const price = num(analysis5.price);
  const sma20 = num(analysis5.sma20);
  if (price === null || price <= 0 || sma20 === null || sma20 <= 0) {
    return pack(false, BIAS_NEUTRAL, 'SMA-20 warming up', 'Need ≥20 five-minute bars for SMA-20.', price, sma20, null, null);
  }
  const extPct = Math.round((Math.abs(price - sma20) / price) * 10000) / 100;
  if (price > sma20) {
    return pack(
      true,
      BIAS_LONG,
      '5m above SMA-20 · long only',
      `Price ${price.toFixed(2)} above 5m SMA-20 ${sma20.toFixed(2)} — Stratzy long bias.`,
      price,
      sma20,
      true,
      extPct,
    );
  }
  if (price < sma20) {
    return pack(
      true,
      BIAS_SHORT,
      '5m below SMA-20 · short only',
      `Price ${price.toFixed(2)} below 5m SMA-20 ${sma20.toFixed(2)} — Stratzy short bias.`,
      price,
      sma20,
      false,
      extPct,
    );
  }
  return pack(true, BIAS_NEUTRAL, '5m at SMA-20', 'Price equals 5m SMA-20 — stand aside until side is clear.', price, sma20, null, 0);
}

export function gateReasons(
  analysis5: Record<string, unknown> | null | undefined,
  planBias: string,
  options: { max_sma20_extension_pct?: number } = {},
): string[] {
  if (!['long', 'short'].includes(planBias)) return [];
  if (!analysis5) return ['5m SMA-20 filter — 5m data unavailable'];
  const state = fromAnalysis(analysis5);
  if (!state.ok) return [state.message];
  if (state.bias === BIAS_NEUTRAL) return ['Price at 5m SMA-20 — no directional bias'];
  if (planBias === 'long' && state.bias !== BIAS_LONG) {
    return [`Long blocked — price below 5m SMA-20 (${(state.sma20 ?? 0).toFixed(2)})`];
  }
  if (planBias === 'short' && state.bias !== BIAS_SHORT) {
    return [`Short blocked — price above 5m SMA-20 (${(state.sma20 ?? 0).toFixed(2)})`];
  }

  const maxExt = Number(options.max_sma20_extension_pct ?? 0);
  if (maxExt > 0 && state.extension_pct != null && state.extension_pct > maxExt) {
    return [
      `SMA-20 chase — ${state.extension_pct}% from MA (max ${maxExt}%). Wait for pullback.`,
    ];
  }
  return [];
}

function pack(
  ok: boolean,
  bias: string,
  label: string,
  message: string,
  price: number | null,
  sma20: number | null,
  above: boolean | null,
  extension_pct: number | null,
) {
  return { ok, bias, label, message, price, sma20, above, extension_pct };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
