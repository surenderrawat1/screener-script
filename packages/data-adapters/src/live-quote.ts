import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, CACHE_TTL } from '@sv/shared';
import { httpGet } from './http.js';

function yahooSymbol(symbol: string): string {
  const sym = symbol.toUpperCase().replace(/\.(NS|BO)$/, '');
  if (sym.startsWith('^') || sym.includes('.')) return sym;
  return `${sym}.NS`;
}

/** Last traded price from Yahoo 1m chart — used during NSE cash session. */
export async function liveQuoteForSymbol(symbol: string, refresh = false): Promise<number | null> {
  const yahoo = yahooSymbol(symbol);
  const key = cacheKey(CACHE_PREFIX.YAHOO, `quote:${yahoo}`);
  if (!refresh) {
    const cached = await cacheGetJson<{ price: number }>(key);
    if (cached?.price) return cached.price;
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?interval=1m&range=1d`;
  const body = await httpGet(url);
  if (!body) return null;

  try {
    const json = JSON.parse(body) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number }; indicators?: { quote?: Array<{ close?: number[] }> } }> };
    };
    const result = json.chart?.result?.[0];
    const metaPrice = result?.meta?.regularMarketPrice;
    if (metaPrice && metaPrice > 0) {
      await cacheSetJson(key, { price: metaPrice }, CACHE_TTL.yahoo);
      return metaPrice;
    }
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    for (let i = closes.length - 1; i >= 0; i--) {
      const c = closes[i];
      if (c != null && c > 0) {
        await cacheSetJson(key, { price: c }, CACHE_TTL.yahoo);
        return c;
      }
    }
  } catch {
    return null;
  }
  return null;
}
