import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, getCacheTtl } from '@sv/shared';
import { emptyEtfPanel, etfSymbols, formatEtfPanel } from '@sv/swing';
import { currentMarketRegime } from './market-regime.js';
import { runSwingScan } from './swing-scan.js';

const ETF_CACHE_SEGMENT = 'etf';

export async function getMorningEtfPanel(refresh = false) {
  const key = cacheKey(CACHE_PREFIX.MORNING, ETF_CACHE_SEGMENT);

  if (!refresh) {
    const cached = await cacheGetJson<{ cached_at: string; scan: Record<string, unknown> }>(key);
    if (cached?.scan && Array.isArray(cached.scan.hits)) {
      return formatEtfPanel(cached.scan, cached.cached_at, true);
    }
  }

  const started = Date.now();
  try {
    const regime = await currentMarketRegime(false);
    const scan = await runSwingScan(
      etfSymbols(),
      { min_verdict: 'SETUP_PLUS', sort_by: 'swing_rank', regime },
      refresh,
    );
    const scanWithMeta = {
      ...scan,
      elapsed_sec: Math.round((Date.now() - started) / 1000),
    };
    const cachedAt = new Date().toISOString();
    await cacheSetJson(key, { cached_at: cachedAt, scan: scanWithMeta }, getCacheTtl().morning_etf);
    return formatEtfPanel(scanWithMeta, cachedAt, false);
  } catch (err) {
    return emptyEtfPanel(err instanceof Error ? err.message : 'ETF scan failed');
  }
}
