import type { SwingScanHit, SwingScanOptions, SymbolContext, TaMetrics } from './types.js';
import { matchesEntryRules } from './entry-filters.js';
import { evaluateEntry } from './evaluate-entry.js';
import { fromTa } from './gc9-dc9.js';
import { VOLUME_SURGE_MIN } from './dynamic-signals.js';
import { normalizeScanHit } from './hit-normalizer.js';
import { defaultRegime } from './market-regime.js';
import { matchesMinVerdict, rankHits } from './ranker.js';

export const ZONE_52W_ANY = 'any';
export const ZONE_52W_GREEN = 'green';
export const ZONE_52W_MID = 'mid';
export const ZONE_52W_RED = 'red';
export const ZONE_MID_MIN_PCT = 25;
export const ZONE_MID_MAX_PCT = 75;

export type SwingFilterStats = {
  no_ta: number;
  no_price: number;
  min_verdict: number;
  zone_52w: number;
  breakout_volume: number;
  gc9_only: number;
  entry_rules: number;
};

export type SwingScanSummary = {
  hits: number;
  strict_enter: number;
  discovery_enter: number;
  setup: number;
  filter_label: string;
  no_chart: number;
  full_universe: boolean;
};

export function filterLabelForMinVerdict(minVerdict: string): string {
  const min = minVerdict.toUpperCase();
  if (min === 'ENTER') return 'Strict ENTER';
  if (min === 'SETUP_PLUS') return 'SETUP+';
  if (min === 'WATCH') return 'WATCH+';
  if (min === 'ALL') return 'ALL';
  return min;
}

export function buildScanSummary(
  hits: SwingScanHit[],
  minVerdict: string,
  opts: { no_chart?: number; universe_size?: number; scanned?: number } = {},
): SwingScanSummary {
  let strictEnter = 0;
  let discoveryEnter = 0;
  let setup = 0;
  for (const hit of hits) {
    const strict = String(hit.strict_verdict ?? '');
    const discovery = String(hit.verdict ?? hit.discovery_verdict ?? '');
    if (strict === 'ENTER') strictEnter += 1;
    if (discovery === 'ENTER') discoveryEnter += 1;
    if (discovery === 'SETUP') setup += 1;
  }
  const scanned = opts.scanned ?? hits.length;
  const universeSize = opts.universe_size ?? scanned;
  return {
    hits: hits.length,
    strict_enter: strictEnter,
    discovery_enter: discoveryEnter,
    setup,
    filter_label: filterLabelForMinVerdict(minVerdict),
    no_chart: opts.no_chart ?? 0,
    full_universe: universeSize > 0 && scanned >= universeSize,
  };
}

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

export function scanSymbols(
  contexts: SymbolContext[],
  options: SwingScanOptions = {},
): {
  ok: boolean;
  hits: SwingScanHit[];
  scanned: number;
  skipped: number;
  stale: number;
  regime: Record<string, unknown>;
  engine_version: string;
  filter_stats: SwingFilterStats;
  scan_summary: SwingScanSummary;
} {
  const minVerdict = String(options.min_verdict ?? 'SETUP_PLUS').toUpperCase();
  const zone52w = normalizeZone52w(String(options.zone_52w ?? ZONE_52W_ANY));
  const breakoutVolume = Boolean(options.breakout_volume);
  const gc9Only = Boolean(options.gc9_only);
  const regime = options.regime ?? defaultRegime();

  const hits: SwingScanHit[] = [];
  let skipped = 0;
  let staleCount = 0;
  const filterStats: SwingFilterStats = {
    no_ta: 0,
    no_price: 0,
    min_verdict: 0,
    zone_52w: 0,
    breakout_volume: 0,
    gc9_only: 0,
    entry_rules: 0,
  };

  for (const ctx of contexts) {
    if (!ctx.bars.length || !ctx.ta.ta_ready) {
      skipped += 1;
      filterStats.no_ta += 1;
      continue;
    }
    const price = Number(ctx.ta.ta_price ?? ctx.bars[ctx.bars.length - 1]?.close ?? 0);
    if (price <= 0) {
      skipped += 1;
      filterStats.no_price += 1;
      continue;
    }

    const entry = evaluateEntry(ctx.ta, price, ctx.bars, regime, ctx.hourlyBars);
    const discovery = String(entry.discovery_verdict ?? 'AVOID');
    const strict = String(entry.strict_verdict ?? entry.verdict ?? 'AVOID');

    if (!matchesMinVerdict(strict, discovery, minVerdict)) {
      skipped += 1;
      filterStats.min_verdict += 1;
      continue;
    }
    if (!matchesZone52w(Number(ctx.ta.ta_pct_52w ?? null), zone52w, String(ctx.ta.ta_52w_chart_zone ?? ''))) {
      skipped += 1;
      filterStats.zone_52w += 1;
      continue;
    }
    if (!matchesBreakoutVolume(entry, ctx.ta, breakoutVolume)) {
      skipped += 1;
      filterStats.breakout_volume += 1;
      continue;
    }
    if (!matchesGc9Entry(entry, ctx.ta, price, gc9Only)) {
      skipped += 1;
      filterStats.gc9_only += 1;
      continue;
    }
    if (!matchesEntryRules(entry, options)) {
      skipped += 1;
      filterStats.entry_rules += 1;
      continue;
    }

    if (ctx.stale) staleCount += 1;

    const flat = normalizeScanHit(ctx.symbol, price, ctx.ta, entry as Record<string, unknown>, {
      stale: ctx.stale,
      regime_key: String(regime.key ?? ''),
    });

    hits.push(flat as SwingScanHit);
  }

  const sortBy = options.sort_by ?? 'swing_rank';
  let ranked = rankHits(hits);
  ranked = sortHits(ranked, sortBy);

  const engineVersion = String(ranked[0]?.engine_version ?? 'v3.9-gc9');
  const scanSummary = buildScanSummary(ranked, minVerdict, { scanned: contexts.length });

  return {
    ok: true,
    hits: ranked,
    scanned: contexts.length,
    skipped,
    stale: staleCount,
    regime,
    engine_version: engineVersion,
    filter_stats: filterStats,
    scan_summary: scanSummary,
  };
}

function sortHits(hits: SwingScanHit[], sortBy: string): SwingScanHit[] {
  if (sortBy === 'rules_passed') {
    return [...hits].sort((a, b) => (b.rules_passed ?? 0) - (a.rules_passed ?? 0));
  }
  if (sortBy === 'r_multiple') {
    return [...hits].sort((a, b) => Number(b.r_multiple ?? 0) - Number(a.r_multiple ?? 0));
  }
  if (sortBy === 'pct_52w') {
    return [...hits].sort((a, b) => Number(a.ta_pct_52w ?? 0) - Number(b.ta_pct_52w ?? 0));
  }
  if (sortBy === 'volume_ratio') {
    return [...hits].sort((a, b) => Number(b.ta_volume_ratio ?? 0) - Number(a.ta_volume_ratio ?? 0));
  }
  if (sortBy === 'entry_score') {
    return [...hits].sort((a, b) => Number(b.entry_score ?? 0) - Number(a.entry_score ?? 0));
  }
  if (sortBy === 'rsi') {
    return [...hits].sort((a, b) => Number(a.ta_rsi14 ?? 999) - Number(b.ta_rsi14 ?? 999));
  }
  if (sortBy === 'symbol') {
    return [...hits].sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
  }
  return hits;
}

export type ScanEligibility = {
  passes: boolean;
  failed: string[];
};

/** Mirror scanner filters for single-symbol evaluate (transparency; does not block evaluate). */
export function assessScanEligibility(
  entry: Record<string, unknown>,
  ta: TaMetrics,
  price: number,
  options: SwingScanOptions = {},
): ScanEligibility {
  const failed: string[] = [];
  const minVerdict = String(options.min_verdict ?? 'SETUP_PLUS').toUpperCase();
  const zone52w = normalizeZone52w(String(options.zone_52w ?? ZONE_52W_ANY));
  const discovery = String(entry.discovery_verdict ?? 'AVOID');
  const strict = String(entry.strict_verdict ?? entry.verdict ?? 'AVOID');

  if (!matchesMinVerdict(strict, discovery, minVerdict)) {
    failed.push(`Min verdict (${minVerdict})`);
  }
  if (!matchesZone52w(Number(ta.ta_pct_52w ?? null), zone52w, String(ta.ta_52w_chart_zone ?? ''))) {
    failed.push(`52w zone (${zone52w})`);
  }
  if (!matchesBreakoutVolume(entry, ta, Boolean(options.breakout_volume))) {
    failed.push('Breakout + volume surge');
  }
  if (!matchesGc9Entry(entry, ta, price, Boolean(options.gc9_only))) {
    failed.push('GC9 entry only (E11)');
  }
  if (!matchesEntryRules(entry as { rules?: import('./types.js').SwingRule[]; rules_passed?: number }, options)) {
    failed.push('Required entry rules');
  }

  return { passes: failed.length === 0, failed };
}
