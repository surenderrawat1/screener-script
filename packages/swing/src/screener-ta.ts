import { bottomOutHint } from './detail-ta.js';
import { matchesZone52w, normalizeZone52w } from './scanner.js';
import type { TaMetrics } from './types.js';

/** TA gate fields merged from screener presets (PHP ScreenerInputResolver parity). */
export interface ScreenerTaFilters {
  technical_only?: boolean;
  show_ta?: boolean;
  ta_preset?: boolean;
  min_rsi?: number;
  max_rsi?: number;
  min_pct_52w?: number;
  max_pct_52w?: number;
  min_bb_pct_b?: number;
  max_bb_pct_b?: number;
  above_sma20?: boolean;
  above_sma50?: boolean;
  above_sma200?: boolean;
  zone_52w?: string;
  green_zone_52w?: boolean;
  macd_bullish?: boolean;
  below_bb_lower?: boolean;
  bottom_out_hint?: boolean;
  golden_cross_50_200?: boolean;
  death_cross_50_200?: boolean;
  golden_cross_9_50?: boolean;
  death_cross_9_50?: boolean;
  bull_ma_stack?: boolean;
  bear_ma_stack?: boolean;
}

const SMA_CROSS_KEYS = [
  'golden_cross_50_200',
  'death_cross_50_200',
  'golden_cross_9_50',
  'death_cross_9_50',
  'bull_ma_stack',
  'bear_ma_stack',
] as const;

export function taFiltersActive(filters: ScreenerTaFilters = {}): boolean {
  if (filters.technical_only) return true;
  if (filters.above_sma50 || filters.above_sma200 || filters.above_sma20) return true;
  if (filters.green_zone_52w) return true;
  if (filters.zone_52w && normalizeZone52w(filters.zone_52w) !== 'any') return true;
  for (const key of SMA_CROSS_KEYS) {
    if (filters[key]) return true;
  }
  if (filters.macd_bullish || filters.below_bb_lower || filters.bottom_out_hint) return true;
  for (const key of ['min_rsi', 'max_rsi', 'min_pct_52w', 'max_pct_52w', 'min_bb_pct_b', 'max_bb_pct_b'] as const) {
    const v = filters[key];
    if (v !== undefined && v !== null && Number.isFinite(Number(v))) return true;
  }
  return false;
}

export function needsCrossoverMetrics(filters: ScreenerTaFilters = {}): boolean {
  for (const key of SMA_CROSS_KEYS) {
    if (filters[key]) return true;
  }
  return false;
}

function activeZone52w(filters: ScreenerTaFilters): string {
  if (filters.zone_52w) return normalizeZone52w(filters.zone_52w);
  if (filters.green_zone_52w) return 'green';
  return 'any';
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function bool(v: unknown): boolean {
  return v === true;
}

/** PHP CfaStockAnalyzer::checkTechnicalFilters parity. */
export function passesTaFilters(ta: TaMetrics, filters: ScreenerTaFilters = {}): boolean {
  if (!taFiltersActive(filters)) return true;
  if (!ta.ta_ready) return false;

  const rsi = num(ta.ta_rsi14);
  if (filters.min_rsi != null && filters.min_rsi > 0) {
    if (rsi === null || rsi < filters.min_rsi) return false;
  }
  if (filters.max_rsi != null && filters.max_rsi > 0) {
    if (rsi === null || rsi > filters.max_rsi) return false;
  }

  if (filters.above_sma50 && !bool(ta.ta_above_sma50)) return false;
  if (filters.above_sma20 && !bool(ta.ta_above_sma20)) return false;
  if (filters.above_sma200 && !bool(ta.ta_above_sma200)) return false;

  const zone = activeZone52w(filters);
  if (zone !== 'any') {
    const pct52 = num(ta.ta_pct_52w);
    const chartZone = typeof ta.ta_52w_chart_zone === 'string' ? ta.ta_52w_chart_zone : null;
    if (!matchesZone52w(pct52, zone, chartZone)) return false;
  }

  const crossChecks: Array<[keyof ScreenerTaFilters, string]> = [
    ['golden_cross_50_200', 'ta_golden_cross_50_200'],
    ['death_cross_50_200', 'ta_death_cross_50_200'],
    ['golden_cross_9_50', 'ta_golden_cross_9_50'],
    ['death_cross_9_50', 'ta_death_cross_9_50'],
    ['bull_ma_stack', 'ta_bull_ma_stack'],
    ['bear_ma_stack', 'ta_bear_ma_stack'],
  ];
  for (const [presetKey, taKey] of crossChecks) {
    if (filters[presetKey] && !bool(ta[taKey])) return false;
  }

  const pct52 = num(ta.ta_pct_52w);
  if (filters.min_pct_52w != null && Number.isFinite(filters.min_pct_52w)) {
    if (pct52 === null || pct52 < filters.min_pct_52w) return false;
  }
  if (filters.max_pct_52w != null && filters.max_pct_52w < 100) {
    if (pct52 === null || pct52 > filters.max_pct_52w) return false;
  }

  if (filters.macd_bullish && !bool(ta.ta_macd_bullish)) return false;
  if (filters.below_bb_lower && !bool(ta.ta_below_bb_lower)) return false;

  if (filters.bottom_out_hint) {
    let hint = ta.ta_bottom_out_hint;
    if (hint === null || hint === undefined) {
      const calc = bottomOutHint(ta);
      hint = calc.hint;
    }
    if (!hint) return false;
  }

  const bbPct = num(ta.ta_bb_pct_b);
  if (filters.min_bb_pct_b != null && Number.isFinite(filters.min_bb_pct_b)) {
    if (bbPct === null || bbPct < filters.min_bb_pct_b) return false;
  }
  if (filters.max_bb_pct_b != null && filters.max_bb_pct_b < 100) {
    if (bbPct === null || bbPct > filters.max_bb_pct_b) return false;
  }

  return true;
}

/** Attach display fields to screener rows. */
export function taFieldsForRow(ta: TaMetrics): Record<string, unknown> {
  return {
    ta_ready: Boolean(ta.ta_ready),
    ta_rsi14: num(ta.ta_rsi14),
    ta_pct_52w: num(ta.ta_pct_52w),
    ta_macd_hist: num(ta.ta_macd_hist),
    ta_bb_pct_b: num(ta.ta_bb_pct_b),
    ta_bottom_out_hint: ta.ta_bottom_out_hint === true,
    ta_bottom_out_score: num(ta.ta_bottom_out_score),
    ta_52w_chart_zone: typeof ta.ta_52w_chart_zone === 'string' ? ta.ta_52w_chart_zone : null,
    ta_above_sma50: ta.ta_above_sma50 === true ? true : ta.ta_above_sma50 === false ? false : null,
    ta_macd_bullish: ta.ta_macd_bullish === true ? true : ta.ta_macd_bullish === false ? false : null,
  };
}
