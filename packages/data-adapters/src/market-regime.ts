import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, CACHE_TTL } from '@sv/shared';
import { defaultRegime, regimeFromBars } from '@sv/swing';
import { fetchDailyBars } from './swing-chart.js';

export async function currentMarketRegime(refresh = false): Promise<Record<string, unknown>> {
  const cacheK = cacheKey(CACHE_PREFIX.REGIME, 'nifty');
  if (!refresh) {
    const cached = await cacheGetJson<Record<string, unknown>>(cacheK);
    if (cached?.key) return cached;
  }

  const bars = await fetchDailyBars('NIFTYBEES', refresh);
  if (bars.length < 50) {
    const fallback = defaultRegime('proxy_unavailable');
    await cacheSetJson(cacheK, fallback, CACHE_TTL.regime);
    return fallback;
  }

  const regime = regimeFromBars(bars);
  await cacheSetJson(cacheK, regime, CACHE_TTL.regime);
  return regime;
}
