/**
 * Fresh price ↔ SMA/EMA cross detection for screener technical filters.
 * "Fresh" = cross completed within the last N bars (default 3).
 */
import type { OhlcBar, TaMetrics } from './types.js';
import { emaSeriesIndexed } from './ta-helper.js';

export const FRESH_CROSS_DEFAULT_BARS = 3;
export const FRESH_CROSS_MAX_LOOKBACK = 5;

export type MaKind = 'sma' | 'ema';
export type CrossDirection = 'above' | 'below';
export type MaPeriod = 20 | 50;

function smaAt(closes: number[], index: number, period: number): number | null {
  if (index + 1 < period || index < 0) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i++) sum += closes[i];
  return sum / period;
}

/** Bars ago (0 = current bar) when price freshly crossed MA, or null. */
export function priceMaCrossBarsAgo(
  closes: number[],
  period: number,
  direction: CrossDirection,
  kind: MaKind = 'sma',
  maxLookback = FRESH_CROSS_MAX_LOOKBACK,
): number | null {
  if (closes.length < period + 1) return null;
  const emaMap = kind === 'ema' ? emaSeriesIndexed(closes, period) : null;
  const maAt = (i: number): number | null => {
    if (kind === 'sma') return smaAt(closes, i, period);
    const v = emaMap?.get(i);
    return v === undefined ? null : v;
  };

  const limit = Math.min(maxLookback, closes.length - 1);
  for (let barsAgo = 0; barsAgo < limit; barsAgo++) {
    const currIdx = closes.length - 1 - barsAgo;
    const prevIdx = currIdx - 1;
    if (prevIdx < 0) break;
    const maCurr = maAt(currIdx);
    const maPrev = maAt(prevIdx);
    if (maCurr == null || maPrev == null) continue;
    const prevClose = closes[prevIdx];
    const currClose = closes[currIdx];
    if (direction === 'above') {
      if (prevClose <= maPrev && currClose > maCurr) return barsAgo;
    } else if (prevClose >= maPrev && currClose < maCurr) {
      return barsAgo;
    }
  }
  return null;
}

export function priceMaCrossMetrics(
  bars: OhlcBar[],
  prefix: '' | 'h_' = '',
  maxLookback = FRESH_CROSS_MAX_LOOKBACK,
): TaMetrics {
  const closes = bars.map((b) => b.close);
  const p = prefix; // '' daily, 'h_' hourly
  const out: TaMetrics = {};
  for (const period of [20, 50] as MaPeriod[]) {
    for (const kind of ['sma', 'ema'] as MaKind[]) {
      const above = priceMaCrossBarsAgo(closes, period, 'above', kind, maxLookback);
      const below = priceMaCrossBarsAgo(closes, period, 'below', kind, maxLookback);
      out[`ta_${p}cross_above_${kind}${period}_bars`] = above;
      out[`ta_${p}cross_below_${kind}${period}_bars`] = below;
      out[`ta_${p}cross_above_${kind}${period}`] = above !== null && above < FRESH_CROSS_DEFAULT_BARS;
      out[`ta_${p}cross_below_${kind}${period}`] = below !== null && below < FRESH_CROSS_DEFAULT_BARS;
    }
  }
  return out;
}

/** Filter key → TA bars-ago metric key (daily). */
export const DAILY_PRICE_CROSS_FILTERS = [
  'cross_above_sma20',
  'cross_below_sma20',
  'cross_above_sma50',
  'cross_below_sma50',
  'cross_above_ema20',
  'cross_below_ema20',
  'cross_above_ema50',
  'cross_below_ema50',
] as const;

export const HOURLY_PRICE_CROSS_FILTERS = [
  'hourly_cross_above_sma20',
  'hourly_cross_below_sma20',
  'hourly_cross_above_sma50',
  'hourly_cross_below_sma50',
  'hourly_cross_above_ema20',
  'hourly_cross_below_ema20',
  'hourly_cross_above_ema50',
  'hourly_cross_below_ema50',
] as const;

export type DailyPriceCrossFilter = (typeof DAILY_PRICE_CROSS_FILTERS)[number];
export type HourlyPriceCrossFilter = (typeof HOURLY_PRICE_CROSS_FILTERS)[number];

export function dailyCrossFilterToTaKey(filter: DailyPriceCrossFilter): string {
  return `ta_${filter}_bars`;
}

export function hourlyCrossFilterToTaKey(filter: HourlyPriceCrossFilter): string {
  // hourly_cross_above_sma20 → ta_h_cross_above_sma20_bars
  return `ta_h_${filter.replace(/^hourly_/, '')}_bars`;
}

export function priceCrossFilterActive(
  filters: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.some((k) => filters[k] === true);
}

export function passesFreshCross(
  barsAgo: number | null | undefined,
  freshBars: number,
): boolean {
  if (barsAgo === null || barsAgo === undefined || !Number.isFinite(barsAgo)) return false;
  const n = Math.max(1, Math.min(FRESH_CROSS_MAX_LOOKBACK, Math.floor(freshBars)));
  return barsAgo < n;
}
