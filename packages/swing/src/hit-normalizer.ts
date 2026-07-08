import type { SwingRule, TaMetrics } from './types.js';

/** Flatten evaluateEntry + TA onto a scan hit for auto-decision, UI, and API parity. */
export function normalizeScanHit(
  symbol: string,
  price: number,
  ta: TaMetrics,
  entry: Record<string, unknown>,
  extras: { stale?: boolean; regime_key?: string } = {},
): Record<string, unknown> {
  const pa = (entry.price_action ?? {}) as Record<string, unknown>;
  const dynamic = (entry.dynamic ?? {}) as Record<string, unknown>;
  const rules = (entry.rules ?? []) as SwingRule[];

  return {
    symbol,
    price: Math.round(price * 100) / 100,
    verdict: String(entry.discovery_verdict ?? 'AVOID'),
    strict_verdict: String(entry.strict_verdict ?? entry.verdict ?? 'AVOID'),
    discovery_verdict: String(entry.discovery_verdict ?? 'AVOID'),
    entry_score: Number(entry.entry_score ?? 0),
    entry_score_detail: entry.entry_score_detail ?? null,
    rules_passed: Number(entry.rules_passed ?? 0),
    rules_scored: Number(entry.rules_scored ?? 0),
    rules,
    entry_rules: rules,
    stop_loss: entry.stop_loss ?? null,
    profit_target: entry.profit_target ?? null,
    r_multiple: entry.r_multiple ?? null,
    r_multiple_ok: Boolean(entry.r_multiple_ok),
    target_pct: entry.target_pct ?? null,
    strict_enter_ready: Boolean(entry.strict_enter_ready),
    net_edge_ok: Boolean(entry.net_edge_ok),
    ta_avg_value_cr: num(ta.ta_avg_value_cr),
    ta_rsi14: num(ta.ta_rsi14),
    ta_pct_52w: num(ta.ta_pct_52w),
    ta_52w_chart_zone: String(ta.ta_52w_chart_zone ?? ''),
    ta_volume_ratio: num(ta.ta_volume_ratio) ?? num(dynamic.volume_ratio),
    ta_macd_hist: num(ta.ta_macd_hist),
    ta_52w_low_date: String(ta.ta_52w_low_date ?? ''),
    ta_52w_high_date: String(ta.ta_52w_high_date ?? ''),
    ta_sma50: num(ta.ta_sma50),
    ta_ema21: num(ta.ta_ema21),
    as_of_date: String(ta.ta_as_of_date ?? ta.as_of_date ?? ''),
    broke_swing_high: Boolean(pa.broke_swing_high),
    volume_surge: Boolean(dynamic.volume_surge),
    gc9_entry: Boolean((entry.gc9 as Record<string, unknown> | undefined)?.gc9_entry),
    price_action: pa,
    dynamic,
    gc9: entry.gc9 ?? null,
    entry,
    stale: Boolean(extras.stale),
    regime_key: extras.regime_key ?? null,
    engine_version: String(entry.engine_version ?? 'v3.9-gc9'),
  };
}

export function flattenHitForApi(hit: Record<string, unknown>): Record<string, unknown> {
  if (hit.entry_rules || hit.rules) return hit;
  const entry = (hit.entry ?? {}) as Record<string, unknown>;
  if (!entry.rules) return hit;
  return normalizeScanHit(
    String(hit.symbol ?? ''),
    Number(hit.price ?? 0),
    {},
    entry,
    { stale: Boolean(hit.stale), regime_key: String(hit.regime_key ?? '') || undefined },
  );
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
