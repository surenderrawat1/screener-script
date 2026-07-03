import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, CACHE_TTL } from '@sv/shared';
import type { OhlcBar } from '@sv/swing';
import { httpGet } from './http.js';

const YAHOO_SYMBOLS = ['^NSEI', 'NIFTYBEES.NS'];

export type IntradayChart = {
  symbol: string;
  yahoo: string;
  interval: '5m' | '15m';
  range: string;
  bars: IntradayBar[];
  closes: number[];
  fetched_at: string;
};

export type IntradayBar = Omit<OhlcBar, 'time'> & {
  time: number;
  time_label: string;
};

function istLabel(unixSec: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(unixSec * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function yahooInterval(interval: '5m' | '15m'): string {
  return interval === '5m' ? '5m' : '15m';
}

export async function fetchInstrumentIntradayChart(
  instrumentCacheKey: string,
  yahooSymbols: string[],
  displaySymbol: string,
  interval: '5m' | '15m' = '15m',
  refresh = false,
): Promise<IntradayChart | null> {
  const normalizedKey = instrumentCacheKey.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const cacheKeyStr = cacheKey(CACHE_PREFIX.TA, `intraday:${normalizedKey}:${interval}`);
  if (!refresh) {
    const cached = await cacheGetJson<IntradayChart>(cacheKeyStr);
    if (cached?.bars?.length) return cached;
  }

  for (const yahooSymbol of yahooSymbols) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${yahooInterval(interval)}&range=5d`;
    const body = await httpGet(url);
    if (!body) continue;
    try {
      const json = JSON.parse(body) as {
        chart?: {
          result?: Array<{
            timestamp?: number[];
            indicators?: { quote?: Array<{ open?: number[]; high?: number[]; low?: number[]; close?: number[]; volume?: number[] }> };
          }>;
        };
      };
      const result = json.chart?.result?.[0];
      const ts = result?.timestamp ?? [];
      const quote = result?.indicators?.quote?.[0];
      if (!quote || ts.length === 0) continue;

      const bars: IntradayBar[] = [];
      const closes: number[] = [];
      for (let i = 0; i < ts.length; i++) {
        const close = quote.close?.[i];
        if (close === null || close === undefined || close <= 0) continue;
        const unix = ts[i];
        bars.push({
          time: unix,
          time_label: istLabel(unix),
          open: Number(quote.open?.[i] ?? close),
          high: Number(quote.high?.[i] ?? close),
          low: Number(quote.low?.[i] ?? close),
          close: Number(close),
          volume: Number(quote.volume?.[i] ?? 0),
        });
        closes.push(Number(close));
      }

      const minBars = interval === '5m' ? 30 : 20;
      if (bars.length < minBars) continue;

      const chart: IntradayChart = {
        symbol: displaySymbol,
        yahoo: yahooSymbol,
        interval,
        range: '5d',
        bars,
        closes,
        fetched_at: new Date().toISOString(),
      };
      const ttl = interval === '5m' ? 90 : CACHE_TTL.intraday;
      await cacheSetJson(cacheKeyStr, chart, ttl);
      return chart;
    } catch {
      continue;
    }
  }
  return null;
}

export async function fetchIntradayChart(interval: '5m' | '15m' = '15m', refresh = false): Promise<IntradayChart | null> {
  return fetchInstrumentIntradayChart('NIFTY50', YAHOO_SYMBOLS, 'NIFTY50', interval, refresh);
}

export async function fetchNiftyIntradayCharts(refresh = false) {
  const [chart5, chart15] = await Promise.all([
    fetchIntradayChart('5m', refresh),
    fetchIntradayChart('15m', refresh),
  ]);
  return { chart5, chart15 };
}
