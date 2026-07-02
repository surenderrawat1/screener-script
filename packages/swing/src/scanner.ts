import type { OhlcBar, SwingScanHit, SwingScanOptions, TaMetrics } from './types.js';
import { evaluateEntry } from './evaluate-entry.js';
import { fromTa } from './gc9-dc9.js';
import { VOLUME_SURGE_MIN } from './dynamic-signals.js';
import { defaultRegime } from './market-regime.js';
import { matchesMinVerdict, rankHits } from './ranker.js';

export const ZONE_52W_ANY = 'any';
export const ZONE_52W_GREEN = 'green';
export const ZONE_52W_MID = 'mid';
export const ZONE_52W_RED = 'red';
export const ZONE_MID_MIN_PCT = 25;
export const ZONE_MID_MAX_PCT = 75;

export function matchesGc9Entry(entry: Record<string, unknown>, ta: TaMetrics, price: number, required: boolean): boolean {
  if (!required) return true;
  const gc9 = (entry.gc9 as Record<string, unknown>) ?? fromTa(ta, price);
  return Boolean(gc9.gc9_entry);
}

export function matchesBreakoutVolume(entry: Record<string, unknown>, ta: TaMetrics, required: boolean): boolean {
  if (!required) return true;
  const pa = (entry.price_action ?? {}) as Record<string, unknown>;
  if (!pa.broke_swing_high) return false;
  const dynamic = (entry.dynamic ?? {}) as Record<string, unknown>;
  if (dynamic.volume_surge) return true;
  const ratio = Number(ta.ta_volume_ratio ?? dynamic.volume_ratio ?? 0);
  return ratio >= VOLUME_SURGE_MIN;
}

export function matchesZone52w(pct52w: number | null, zone: string, chartZone?: string | null): boolean {
  const z = normalizeZone52w(zone);
  if (z === ZONE_52W_ANY) return true;
  if (z === ZONE_52W_GREEN) return chartZone === ZONE_52W_GREEN;
  if (z === ZONE_52W_RED) return chartZone === ZONE_52W_RED;
  if (z === ZONE_52W_MID) return pct52w !== null && pct52w >= ZONE_MID_MIN_PCT && pct52w <= ZONE_MID_MAX_PCT;
  return true;
}

export function normalizeZone52w(zone: string): string {
  const z = zone.toLowerCase().trim();
  return [ZONE_52W_ANY, ZONE_52W_GREEN, ZONE_52W_MID, ZONE_52W_RED].includes(z) ? z : ZONE_52W_ANY;
}

export interface SymbolContext {
  symbol: string;
  bars: OhlcBar[];
  ta: TaMetrics;
  stale?: boolean;
}

export function scanSymbols(
  contexts: SymbolContext[],
  options: SwingScanOptions = {},
): { ok: boolean; hits: SwingScanHit[]; scanned: number; skipped: number; stale: number; regime: Record<string, unknown>; engine_version: string } {
  const minVerdict = String(options.min_verdict ?? 'SETUP_PLUS').toUpperCase();
  const zone52w = normalizeZone52w(String(options.zone_52w ?? ZONE_52W_ANY));
  const breakoutVolume = Boolean(options.breakout_volume);
  const gc9Only = Boolean(options.gc9_only);
  const regime = options.regime ?? defaultRegime();

  const hits: SwingScanHit[] = [];
  let skipped = 0;
  let staleCount = 0;

  for (const ctx of contexts) {
    if (!ctx.bars.length || !ctx.ta.ta_ready) {
      skipped += 1;
      continue;
    }
    const price = Number(ctx.ta.ta_price ?? ctx.bars[ctx.bars.length - 1]?.close ?? 0);
    if (price <= 0) {
      skipped += 1;
      continue;
    }

    const entry = evaluateEntry(ctx.ta, price, ctx.bars, regime);
    const discovery = String(entry.discovery_verdict ?? 'AVOID');
    const strict = String(entry.strict_verdict ?? entry.verdict ?? 'AVOID');

    if (!matchesMinVerdict(strict, discovery, minVerdict)) {
      skipped += 1;
      continue;
    }
    if (!matchesZone52w(Number(ctx.ta.ta_pct_52w ?? null), zone52w, String(ctx.ta.ta_52w_chart_zone ?? ''))) {
      skipped += 1;
      continue;
    }
    if (!matchesBreakoutVolume(entry, ctx.ta, breakoutVolume)) {
      skipped += 1;
      continue;
    }
    if (!matchesGc9Entry(entry, ctx.ta, price, gc9Only)) {
      skipped += 1;
      continue;
    }

    if (ctx.stale) staleCount += 1;

    hits.push({
      symbol: ctx.symbol,
      price,
      verdict: discovery,
      strict_verdict: strict,
      entry_score: Number(entry.entry_score ?? 0),
      rules_passed: Number(entry.rules_passed ?? 0),
      stop_loss: entry.stop_loss as number | null,
      profit_target: entry.profit_target as number | null,
      r_multiple: entry.r_multiple as number | null,
      r_multiple_ok: Boolean(entry.r_multiple_ok),
      ta_avg_value_cr: Number(ctx.ta.ta_avg_value_cr ?? null) || null,
      stale: ctx.stale,
      regime_key: String(regime.key ?? ''),
      engine_version: String(entry.engine_version),
      entry,
    });
  }

  const sortBy = options.sort_by ?? 'swing_rank';
  let ranked = rankHits(hits);
  if (sortBy === 'rules_passed') {
    ranked = [...ranked].sort((a, b) => (b.rules_passed ?? 0) - (a.rules_passed ?? 0));
  }

  return {
    ok: true,
    hits: ranked,
    scanned: contexts.length,
    skipped,
    stale: staleCount,
    regime,
    engine_version: String(ranked[0]?.engine_version ?? 'v3.9-gc9'),
  };
}
