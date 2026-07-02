import { cacheClearSymbol } from '@sv/cache';
import { screenSymbol } from '@sv/core';
import { CACHE_PREFIX } from '@sv/shared';
import { cacheGetJson, cacheKey } from '@sv/cache';
import { verifyStock } from './screener-run.js';
import { fetchDailyBars } from './swing-chart.js';
import { fetchScreenerProfile } from './screener-profile.js';
import { fetchStockData } from './stock-data-fetcher.js';
import { ivDriftHint } from './live-parity.js';

export interface RefreshStockResult {
  symbol: string;
  deleted_keys: number;
  summary: Awaited<ReturnType<typeof getRefreshedSummary>>;
}

async function getRefreshedSummary(symbol: string) {
  const { metrics, analysis, sources, from_cache } = await verifyStock(symbol, true);
  const screenerRow = screenSymbol(symbol, metrics);
  const fullIv = Number((analysis as { intrinsic?: number }).intrinsic ?? 0);
  const screenerIv = Number(screenerRow.intrinsic ?? 0);
  const iv_drift = ivDriftHint(screenerIv, fullIv);

  return {
    symbol: String(metrics.symbol ?? symbol).toUpperCase(),
    name: String(metrics.name ?? metrics.symbol ?? symbol),
    success: true,
    metrics,
    valuation: {
      intrinsic: fullIv,
      mos: (analysis as { mos?: number | null }).mos ?? null,
      zone: String((analysis as { zone?: string }).zone ?? ''),
      fair_pe: Number((analysis as { fair_pe?: number }).fair_pe ?? 0),
      quality_score: Number((analysis as { quality_score?: number }).quality_score ?? 0),
      composite_score: Number(
        (analysis as { composite_score?: number }).composite_score ??
          (analysis as { quality_score?: number }).quality_score ??
          0,
      ),
      verify_score: Number((analysis as { verify_score?: number }).verify_score ?? 0),
      recommendation: String((analysis as { recommendation?: string }).recommendation ?? ''),
      final_rating: String(
        (analysis as { final_rating?: string }).final_rating ??
          (analysis as { recommendation?: string }).recommendation ??
          '',
      ),
      graham: Number((analysis as { graham?: number }).graham ?? 0),
      method: String((analysis as { method?: string }).method ?? ''),
    },
    sources,
    from_cache,
    iv_drift,
    screener_iv: screenerIv,
  };
}

/** Clear symbol caches and refetch summary + chart + profile data. */
export async function refreshStockSymbol(symbol: string): Promise<RefreshStockResult> {
  const normalized = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  let deleted_keys = 0;
  try {
    deleted_keys = await cacheClearSymbol(normalized);
  } catch {
    deleted_keys = 0;
  }

  await Promise.all([
    fetchStockData(normalized, { refresh: true }).catch(() => undefined),
    fetchDailyBars(normalized, true).catch(() => []),
    fetchScreenerProfile(normalized, 'consolidated', true).catch(() => null),
  ]);

  const summary = await getRefreshedSummary(normalized);
  return { symbol: normalized, deleted_keys, summary };
}

/** Compare cached verify IV vs fresh stock-cache estimate (stale-cache detector). */
export async function detectStaleIvDrift(
  symbol: string,
  verifyIntrinsic: number,
): Promise<ReturnType<typeof ivDriftHint>> {
  const sym = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  const stockKey = cacheKey(CACHE_PREFIX.STOCK, sym);
  const cached = await cacheGetJson<{ metrics?: Record<string, unknown> }>(stockKey);
  if (!cached?.metrics) return null;

  const { estimate } = await import('@sv/core');
  const est = estimate(cached.metrics);
  const stockIv = Number(est.intrinsic ?? 0);
  if (stockIv <= 0 || verifyIntrinsic <= 0) return null;
  if (Math.abs(stockIv - verifyIntrinsic) < 0.5) return null;
  return ivDriftHint(stockIv, verifyIntrinsic);
}
