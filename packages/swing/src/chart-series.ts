import type { OhlcBar } from './types.js';

export interface SmaPoint {
  time: string;
  value: number;
}

export interface DailyChartPayload {
  symbol: string;
  interval: string;
  range: string;
  bars: OhlcBar[];
  sma9: SmaPoint[];
  sma20: SmaPoint[];
  sma50: SmaPoint[];
  sma200: SmaPoint[];
  fetched_at: string;
}

export function smaLineSeriesFromBars(bars: OhlcBar[], period: number): SmaPoint[] {
  if (period < 1 || bars.length < period) return [];
  const closes = bars.map((b) => b.close);
  const times = bars.map((b) => b.time);
  const out: SmaPoint[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  out.push({ time: times[period - 1], value: Math.round((sum / period) * 100) / 100 });
  for (let i = period; i < closes.length; i++) {
    sum += closes[i] - closes[i - period];
    out.push({ time: times[i], value: Math.round((sum / period) * 100) / 100 });
  }
  return out;
}

export function buildDailyChartPayload(bars: OhlcBar[], symbol: string, range = '2y'): DailyChartPayload {
  return {
    symbol: symbol.toUpperCase(),
    interval: '1d',
    range,
    bars,
    sma9: smaLineSeriesFromBars(bars, 9),
    sma20: smaLineSeriesFromBars(bars, 20),
    sma50: smaLineSeriesFromBars(bars, 50),
    sma200: smaLineSeriesFromBars(bars, 200),
    fetched_at: new Date().toISOString(),
  };
}

export function lastSeriesValue(series: SmaPoint[] | null | undefined): number | null {
  if (!series?.length) return null;
  const v = series[series.length - 1]?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function seriesSlopePct(series: SmaPoint[] | null | undefined, lookback = 20): number | null {
  if (!series || series.length < lookback + 1) return null;
  const slice = series.slice(-lookback);
  const first = slice[0]?.value ?? 0;
  const last = slice[slice.length - 1]?.value ?? 0;
  if (first <= 0) return null;
  return Math.round(((last - first) / first) * 1000) / 10;
}
