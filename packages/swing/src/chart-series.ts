import type { OhlcBar } from './types.js';
import { normalizeSwingChartTimeframe, type SwingChartTimeframe, swingChartYahooParams } from './chart-timeframe.js';

export interface SmaPoint {
  time: string | number;
  value: number;
}

export interface ChartBar {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface DailyChartPayload {
  symbol: string;
  interval: string;
  range: string;
  bars: ChartBar[];
  sma9: SmaPoint[];
  sma20: SmaPoint[];
  sma50: SmaPoint[];
  sma200: SmaPoint[];
  fetched_at: string;
  intraday?: boolean;
}

function chartTimeFromBar(time: string, intraday: boolean): string | number {
  if (!intraday) return String(time).slice(0, 10);
  const ts = Date.parse(time);
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : time;
}

export function smaLineSeriesFromBars(bars: OhlcBar[], period: number, intraday = false): SmaPoint[] {
  if (period < 1 || bars.length < period) return [];
  const closes = bars.map((b) => b.close);
  const times = bars.map((b) => b.time);
  const out: SmaPoint[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  out.push({
    time: chartTimeFromBar(times[period - 1], intraday),
    value: Math.round((sum / period) * 100) / 100,
  });
  for (let i = period; i < closes.length; i++) {
    sum += closes[i] - closes[i - period];
    out.push({
      time: chartTimeFromBar(times[i], intraday),
      value: Math.round((sum / period) * 100) / 100,
    });
  }
  return out;
}

export function buildDailyChartPayload(bars: OhlcBar[], symbol: string, range = '2y'): DailyChartPayload {
  return buildSwingChartPayload(bars, symbol, normalizeSwingChartTimeframe(range));
}

export function buildSwingChartPayload(
  bars: OhlcBar[],
  symbol: string,
  timeframe: SwingChartTimeframe = '2y',
): DailyChartPayload {
  const intraday = timeframe === '1h';
  const { interval, range } = swingChartYahooParams(timeframe);

  return {
    symbol: symbol.toUpperCase(),
    interval,
    range,
    bars: bars.map((b) => ({
      time: chartTimeFromBar(b.time, intraday),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    })),
    sma9: smaLineSeriesFromBars(bars, 9, intraday),
    sma20: smaLineSeriesFromBars(bars, 20, intraday),
    sma50: smaLineSeriesFromBars(bars, 50, intraday),
    sma200: smaLineSeriesFromBars(bars, 200, intraday),
    fetched_at: new Date().toISOString(),
    intraday,
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
