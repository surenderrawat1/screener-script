import { cacheGetJson, cacheGetJsonMany, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, getCacheTtl } from '@sv/shared';
import {
  buildSwingChartPayload,
  normalizeSwingChartTimeframe,
  resampleBarsToWeekly,
  swingChartMinBars,
  swingChartYahooParams,
  isSwingChartIntraday,
  type DailyChartPayload,
  type SwingChartTimeframe,
} from '@sv/swing';
import type { OhlcBar } from '@sv/swing';
import { httpGet } from './http.js';

/** Phase B2 — daily/multi-day Yahoo bars are scan-fresh for 24h when refresh=false. */
export const TA_DAILY_BARS_FRESH_MAX_AGE_SEC = 86_400;
/** Hourly / 4H bars go stale faster; 5m/15m refresh after 30m. */
export const TA_HOURLY_BARS_FRESH_MAX_AGE_SEC = 3_600;
export const TA_INTRADAY_SHORT_BARS_FRESH_MAX_AGE_SEC = 1_800;

export type TaBarsCachePayload = {
  bars: OhlcBar[];
  cached_at?: string;
};

export function taBarsFreshMaxAgeSec(timeframe: SwingChartTimeframe): number {
  if (timeframe === '5m' || timeframe === '15m') return TA_INTRADAY_SHORT_BARS_FRESH_MAX_AGE_SEC;
  if (isSwingChartIntraday(timeframe)) return TA_HOURLY_BARS_FRESH_MAX_AGE_SEC;
  return TA_DAILY_BARS_FRESH_MAX_AGE_SEC;
}

/**
 * Soft freshness for `sv:ta` bar payloads.
 * Legacy entries without `cached_at` stay usable while Redis still holds the key (EX gate).
 */
export function isCachedBarsFresh(
  cachedAtIso: string | null | undefined,
  maxAgeSec: number,
  nowMs = Date.now(),
): boolean {
  if (cachedAtIso == null || String(cachedAtIso).trim() === '') return true;
  const t = Date.parse(String(cachedAtIso));
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= Math.max(0, maxAgeSec) * 1000;
}

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
  switch (timeframe) {
    case '1h':
      return cacheKey(CACHE_PREFIX.TA, `bars:1h:${base}`);
    case '4h':
      return cacheKey(CACHE_PREFIX.TA, `bars:240m:60d:${base}`);
    case '5m':
      return cacheKey(CACHE_PREFIX.TA, `bars:5m:5d:${base}`);
    case '15m':
      return cacheKey(CACHE_PREFIX.TA, `bars:15m:5d:${base}`);
    case '1w':
      return cacheKey(CACHE_PREFIX.TA, `bars:1w:${base}`);
    case '2y':
      return cacheKey(CACHE_PREFIX.TA, `bars:${base}`);
    default:
      return cacheKey(CACHE_PREFIX.TA, `bars:${base}:${timeframe}`);
  }
}

/** Public cache key for daily/hourly TA bars (Phase B5 MGET preload). */
export function taBarsCacheKey(symbol: string, timeframeInput: string = '2y'): string {
  const base = symbol.toUpperCase().replace(/\.(NS|BO)$/, '');
  const timeframe = normalizeSwingChartTimeframe(timeframeInput);
  return barsCacheKey(base, timeframe);
}

/**
 * One Redis MGET for all daily (+ optional hourly) TA bar keys in a refresh set.
 * Callers pass the map into fetch/build so per-symbol GETs are skipped.
 */
export async function preloadTaBarsCache(
  symbols: string[],
  options: { include_hourly?: boolean } = {},
): Promise<Map<string, TaBarsCachePayload | null>> {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const raw of symbols) {
    const base = String(raw ?? '')
      .toUpperCase()
      .replace(/\.(NS|BO)$/, '');
    if (!base) continue;
    const dailyKey = barsCacheKey(base, '2y');
    if (!seen.has(dailyKey)) {
      seen.add(dailyKey);
      keys.push(dailyKey);
    }
    if (options.include_hourly) {
      const hourlyKey = barsCacheKey(base, '1h');
      if (!seen.has(hourlyKey)) {
        seen.add(hourlyKey);
        keys.push(hourlyKey);
      }
    }
  }
  const values = await cacheGetJsonMany<TaBarsCachePayload>(keys);
  const map = new Map<string, TaBarsCachePayload | null>();
  for (let i = 0; i < keys.length; i++) {
    map.set(keys[i]!, values[i] ?? null);
  }
  return map;
}

export const BAR_SOURCE_DAILY = 'Yahoo daily';
export const BAR_SOURCE_INTRADAY = 'Yahoo intraday';

export type IntradayInterval = '5m' | '15m';

export type BarFetchResult = {
  bars: OhlcBar[];
  fromCache: boolean;
  source: string;
  cached_at?: string | null;
  cache_age_sec?: number | null;
};

const TA_INTRADAY_BARS_FRESH_MAX_AGE_SEC = 1_800; // 30 min

function intradayBarsCacheKey(base: string, interval: IntradayInterval, range = '5d'): string {
  return cacheKey(CACHE_PREFIX.TA, `bars:${interval}:${range}:${base}`);
}

export async function fetchIntradayBars(
  symbol: string,
  interval: IntradayInterval,
  refresh = false,
  options: { range?: string } = {},
): Promise<OhlcBar[]> {
  const base = symbol.toUpperCase().replace(/\.(NS|BO)$/, '');
  const range = options.range ?? '5d';
  const cacheKeyStr = intradayBarsCacheKey(base, interval, range);
  const maxAgeSec = TA_INTRADAY_BARS_FRESH_MAX_AGE_SEC;
  const nowMs = Date.now();

  if (!refresh) {
    const cached = await cacheGetJson<TaBarsCachePayload>(cacheKeyStr);
    if (cached?.bars?.length && isCachedBarsFresh(cached.cached_at, maxAgeSec, nowMs)) {
      return cached.bars;
    }
  }

  for (const yahooSymbol of yahooSymbols(base)) {
    const bars = await downloadYahooBars(yahooSymbol, interval, range);
    if (bars.length >= 20) {
      const cachedAt = new Date(nowMs).toISOString();
      const ttl = Math.max(getCacheTtl().ta, maxAgeSec);
      const payload = { bars, cached_at: cachedAt } satisfies TaBarsCachePayload;
      await cacheSetJson(cacheKeyStr, payload, ttl);
      return bars;
    }
  }

  return [];
}

/**
 * Per-symbol 4H bars (Yahoo interval=240m).
 * Used for intraday MTF in chart-pattern detection.
 */
export async function fetchFourHourBars(
  symbol: string,
  refresh = false,
  options: { range?: string } = {},
): Promise<OhlcBar[]> {
  const base = symbol.toUpperCase().replace(/\.(NS|BO)$/, '');
  const range = options.range ?? '60d';
  const cacheKeyStr = cacheKey(CACHE_PREFIX.TA, `bars:240m:${range}:${base}`);
  const maxAgeSec = 3_600; // 1h
  const nowMs = Date.now();

  if (!refresh) {
    const cached = await cacheGetJson<TaBarsCachePayload>(cacheKeyStr);
    if (cached?.bars?.length && isCachedBarsFresh(cached.cached_at, maxAgeSec, nowMs)) {
      return cached.bars;
    }
  }

  for (const yahooSymbol of yahooSymbols(base)) {
    const bars = await downloadYahooBars(yahooSymbol, '240m', range);
    if (bars.length >= 30) {
      const cachedAt = new Date(nowMs).toISOString();
      const ttl = Math.max(getCacheTtl().ta, maxAgeSec);
      const payload = { bars, cached_at: cachedAt } satisfies TaBarsCachePayload;
      await cacheSetJson(cacheKeyStr, payload, ttl);
      return bars;
    }
  }

  return [];
}

export type FetchBarsOptions = {
  /** Preloaded Redis payloads from preloadTaBarsCache (Phase B5). */
  preloaded?: Map<string, TaBarsCachePayload | null>;
};

function barsFromPreloadOrNull(
  cacheKeyStr: string,
  preloaded?: Map<string, TaBarsCachePayload | null>,
): TaBarsCachePayload | null | undefined {
  if (!preloaded) return undefined;
  if (!preloaded.has(cacheKeyStr)) return undefined;
  return preloaded.get(cacheKeyStr) ?? null;
}

export async function fetchSwingChartBarsWithMeta(
  symbol: string,
  timeframeInput: string = '2y',
  refresh = false,
  options: FetchBarsOptions = {},
): Promise<BarFetchResult> {
  const base = symbol.toUpperCase().replace(/\.(NS|BO)$/, '');
  const timeframe = normalizeSwingChartTimeframe(timeframeInput);
  const cacheKeyStr = barsCacheKey(base, timeframe);
  const source = isSwingChartIntraday(timeframe) ? BAR_SOURCE_INTRADAY : BAR_SOURCE_DAILY;
  const maxAgeSec = taBarsFreshMaxAgeSec(timeframe);
  const nowMs = Date.now();
  const minBars = swingChartMinBars(timeframe);

  if (!refresh) {
    const preloaded = barsFromPreloadOrNull(cacheKeyStr, options.preloaded);
    const cached =
      preloaded !== undefined
        ? preloaded
        : await cacheGetJson<TaBarsCachePayload>(cacheKeyStr);
    if (cached?.bars?.length && isCachedBarsFresh(cached.cached_at, maxAgeSec, nowMs)) {
      const cachedAt = cached.cached_at ?? null;
      const ageSec =
        cachedAt && Number.isFinite(Date.parse(cachedAt))
          ? Math.max(0, Math.round((nowMs - Date.parse(cachedAt)) / 1000))
          : null;
      return {
        bars: cached.bars,
        fromCache: true,
        source,
        cached_at: cachedAt,
        cache_age_sec: ageSec,
      };
    }
  }

  let bars: OhlcBar[] = [];

  if (timeframe === '1w') {
    const daily = await fetchSwingChartBarsWithMeta(base, '5y', refresh, options);
    bars = resampleBarsToWeekly(daily.bars);
  } else if (timeframe === '5m' || timeframe === '15m') {
    bars = await fetchIntradayBars(base, timeframe, refresh);
  } else if (timeframe === '4h') {
    bars = await fetchFourHourBars(base, refresh);
  } else {
    const { interval, range } = swingChartYahooParams(timeframe);
    for (const yahooSymbol of yahooSymbols(base)) {
      let fetched = await downloadYahooBars(yahooSymbol, interval, range);
      if (fetched.length < minBars && !refresh) {
        await new Promise((r) => setTimeout(r, 400));
        fetched = await downloadYahooBars(yahooSymbol, interval, range);
      }
      if (fetched.length >= minBars) {
        bars = fetched;
        break;
      }
    }
  }

  if (bars.length >= minBars) {
    const cachedAt = new Date(nowMs).toISOString();
    const ttl = Math.max(getCacheTtl().ta, maxAgeSec);
    const payload = { bars, cached_at: cachedAt } satisfies TaBarsCachePayload;
    await cacheSetJson(cacheKeyStr, payload, ttl);
    options.preloaded?.set(cacheKeyStr, payload);
    return {
      bars,
      fromCache: false,
      source,
      cached_at: cachedAt,
      cache_age_sec: 0,
    };
  }

  return { bars: [], fromCache: false, source, cached_at: null, cache_age_sec: null };
}

export async function fetchSwingChartBars(
  symbol: string,
  timeframeInput: string = '2y',
  refresh = false,
  options: FetchBarsOptions = {},
): Promise<OhlcBar[]> {
  const { bars } = await fetchSwingChartBarsWithMeta(symbol, timeframeInput, refresh, options);
  return bars;
}

/** Default 2y daily bars for TA engine / charts (unchanged entry point). */
export async function fetchDailyBars(symbol: string, refresh = false): Promise<OhlcBar[]> {
  const { bars } = await fetchSwingChartBarsWithMeta(symbol, '2y', refresh);
  return bars;
}

export async function fetchDailyBarsWithMeta(
  symbol: string,
  refresh = false,
  options: FetchBarsOptions = {},
): Promise<BarFetchResult> {
  return fetchSwingChartBarsWithMeta(symbol, '2y', refresh, options);
}

/**
 * Bars for walk-forward backtests: Yahoo 5y daily (no native 3y range).
 * Callers should run prepareBacktestBars() to keep last 3y + warmup.
 */
export async function fetchBacktestBars(symbol: string, refresh = false): Promise<OhlcBar[]> {
  const { bars } = await fetchSwingChartBarsWithMeta(symbol, '5y', refresh);
  return bars;
}

export async function fetchHourlyBars(
  symbol: string,
  refresh = false,
  options: FetchBarsOptions = {},
): Promise<OhlcBar[]> {
  return fetchSwingChartBars(symbol, '1h', refresh, options);
}

export async function getSwingChartPayload(
  symbol: string,
  timeframeInput = '2y',
  refresh = false,
): Promise<DailyChartPayload | null> {
  const base = symbol.toUpperCase().replace(/\.(NS|BO)$/, '');
  const timeframe = normalizeSwingChartTimeframe(timeframeInput);
  const bars = await fetchSwingChartBars(base, timeframe, refresh);
  if (bars.length < swingChartMinBars(timeframe)) return null;
  return buildSwingChartPayload(bars, base, timeframe);
}
