import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, CACHE_TTL } from '@sv/shared';
import type { OhlcBar } from '@sv/swing';
import { httpGet } from './http.js';

function yahooSymbols(base: string): string[] {
  const sym = base.toUpperCase().replace(/\.(NS|BO)$/, '');
  return [`${sym}.NS`, `${sym}.BO`];
}

export async function fetchDailyBars(symbol: string, refresh = false): Promise<OhlcBar[]> {
  const base = symbol.toUpperCase().replace(/\.(NS|BO)$/, '');
  const cacheKeyStr = cacheKey(CACHE_PREFIX.TA, `bars:${base}`);
  if (!refresh) {
    const cached = await cacheGetJson<{ bars: OhlcBar[] }>(cacheKeyStr);
    if (cached?.bars?.length) return cached.bars;
  }

  for (const yahooSymbol of yahooSymbols(base)) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=2y`;
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

      const bars: OhlcBar[] = [];
      for (let i = 0; i < ts.length; i++) {
        const close = quote.close?.[i];
        if (close === null || close === undefined || close <= 0) continue;
        bars.push({
          time: new Date(ts[i] * 1000).toISOString().slice(0, 10),
          open: Number(quote.open?.[i] ?? close),
          high: Number(quote.high?.[i] ?? close),
          low: Number(quote.low?.[i] ?? close),
          close: Number(close),
          volume: Number(quote.volume?.[i] ?? 0),
        });
      }
      if (bars.length >= 50) {
        await cacheSetJson(cacheKeyStr, { bars }, CACHE_TTL.ta);
        return bars;
      }
    } catch {
      continue;
    }
  }
  return [];
}
