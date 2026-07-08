import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, getCacheTtl } from '@sv/shared';
import {
  buildSwingChartPayload,
  normalizeSwingChartTimeframe,
  type DailyChartPayload,
  type SwingChartTimeframe,
} from '@sv/swing';
import type { OhlcBar } from '@sv/swing';
import { httpGet } from './http.js';

function yahooSymbols(base: string): string[] {
  const sym = base.toUpperCase().replace(/\.(NS|BO)$/, '');
  return [`${sym}.NS`, `${sym}.BO`];
}

async function downloadYahooBars(yahooSymbol: string, interval: string, range: string): Promise<OhlcBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
  const body = await httpGet(url);
  if (!body) return [];

  try {
    const json = JSON.parse(body) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: number[];
              high?: number[];
              low?: number[];
              close?: number[];
              volume?: number[];
            }>;
          };
        }>;
      };
    };
    const result = json.chart?.result?.[0];
    const ts = result?.timestamp ?? [];
    const quote = result?.indicators?.quote?.[0];
    if (!quote || ts.length === 0) return [];

    const bars: OhlcBar[] = [];
    const intraday = interval !== '1d';
    for (let i = 0; i < ts.length; i++) {
      const close = quote.close?.[i];
      if (close === null || close === undefined || close <= 0) continue;
      bars.push({
        time: intraday
          ? new Date(ts[i] * 1000).toISOString()
          : new Date(ts[i] * 1000).toISOString().slice(0, 10),
        open: Number(quote.open?.[i] ?? close),
        high: Number(quote.high?.[i] ?? close),
        low: Number(quote.low?.[i] ?? close),
        close: Number(close),
        volume: Number(quote.volume?.[i] ?? 0),
      });
    }
    return bars;
  } catch {
    return [];
  }
}

function barsCacheKey(base: string, timeframe: SwingChartTimeframe): string {
  if (timeframe === '1h') return cacheKey(CACHE_PREFIX.TA, `bars:1h:${base}`);
  if (timeframe === '2y') return cacheKey(CACHE_PREFIX.TA, `bars:${base}`);
  return cacheKey(CACHE_PREFIX.TA, `bars:${base}:${timeframe}`);
}

export const BAR_SOURCE_DAILY = 'Yahoo daily';
export const BAR_SOURCE_INTRADAY = 'Yahoo intraday';

export type BarFetchResult = {
  bars: OhlcBar[];
  fromCache: boolean;
  source: string;
};

export async function fetchSwingChartBarsWithMeta(
  symbol: string,
  timeframeInput: string = '2y',
  refresh = false,
): Promise<BarFetchResult> {
  const base = symbol.toUpperCase().replace(/\.(NS|BO)$/, '');
  const timeframe = normalizeSwingChartTimeframe(timeframeInput);
  const cacheKeyStr = barsCacheKey(base, timeframe);
  const source = timeframe === '1h' ? BAR_SOURCE_INTRADAY : BAR_SOURCE_DAILY;

  if (!refresh) {
    const cached = await cacheGetJson<{ bars: OhlcBar[] }>(cacheKeyStr);
    if (cached?.bars?.length) {
      return { bars: cached.bars, fromCache: true, source };
    }
  }

  const { interval, range } =
    timeframe === '1h'
      ? { interval: '60m', range: '60d' }
      : { interval: '1d', range: timeframe };

  for (const yahooSymbol of yahooSymbols(base)) {
    let bars = await downloadYahooBars(yahooSymbol, interval, range);
    if (bars.length < 30 && !refresh) {
      await new Promise((r) => setTimeout(r, 400));
      bars = await downloadYahooBars(yahooSymbol, interval, range);
    }
    if (bars.length >= 30) {
      await cacheSetJson(cacheKeyStr, { bars }, getCacheTtl().ta);
      return { bars, fromCache: false, source };
    }
  }
  return { bars: [], fromCache: false, source };
}

export async function fetchSwingChartBars(
  symbol: string,
  timeframeInput: string = '2y',
  refresh = false,
): Promise<OhlcBar[]> {
  const { bars } = await fetchSwingChartBarsWithMeta(symbol, timeframeInput, refresh);
  return bars;
}

/** Default 2y daily bars for TA engine (unchanged entry point). */
export async function fetchDailyBars(symbol: string, refresh = false): Promise<OhlcBar[]> {
  const { bars } = await fetchSwingChartBarsWithMeta(symbol, '2y', refresh);
  return bars;
}

export async function fetchDailyBarsWithMeta(symbol: string, refresh = false): Promise<BarFetchResult> {
  return fetchSwingChartBarsWithMeta(symbol, '2y', refresh);
}

export async function fetchHourlyBars(symbol: string, refresh = false): Promise<OhlcBar[]> {
  return fetchSwingChartBars(symbol, '1h', refresh);
}

export async function getSwingChartPayload(
  symbol: string,
  timeframeInput = '2y',
  refresh = false,
): Promise<DailyChartPayload | null> {
  const base = symbol.toUpperCase().replace(/\.(NS|BO)$/, '');
  const timeframe = normalizeSwingChartTimeframe(timeframeInput);
  const bars = await fetchSwingChartBars(base, timeframe, refresh);
  if (bars.length < 30) return null;
  return buildSwingChartPayload(bars, base, timeframe);
}
