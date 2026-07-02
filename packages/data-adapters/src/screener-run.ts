import { buildStockMetrics, estimate, matrixVerdict, passesFilters, PRESET_FILTERS, screenSymbol } from '@sv/core';
import type { ScreenerRow, StockMetrics } from '@sv/shared';
import { CACHE_PREFIX, getCacheTtl } from '@sv/shared';
import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { prisma } from '@sv/db';
import { fetchStockData } from './stock-data-fetcher.js';

interface VerifyCachePayload {
  metrics: StockMetrics;
  analysis: Record<string, unknown>;
  sources: string[];
  cached_at: string;
}

export type ScreenerFilters = {
  min_roe?: number;
  min_roce?: number;
  min_mos?: number;
  max_pe?: number;
  min_promoter_holding?: number;
};

export async function resolveStockMetrics(
  symbol: string,
  refresh = false,
): Promise<{ metrics: StockMetrics; sources: string[]; from_cache: boolean }> {
  const fetched = await fetchStockData(symbol, { refresh });
  if (fetched.success && fetched.metrics) {
    const metrics = await applyPromoterHolding(fetched.metrics);
    return {
      metrics,
      sources: fetched.sources,
      from_cache: Boolean(fetched.from_cache),
    };
  }

  return {
    metrics: buildStockMetrics(symbol),
    sources: ['sample_fallback'],
    from_cache: false,
  };
}

export async function verifyStock(symbol: string, refresh = false) {
  const baseSymbol = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  const verifyKey = cacheKey(CACHE_PREFIX.VERIFY, baseSymbol);

  if (!refresh) {
    const cached = await cacheGetJson<VerifyCachePayload>(verifyKey);
    if (cached?.metrics && cached.analysis) {
      return {
        metrics: cached.metrics,
        analysis: cached.analysis,
        sources: cached.sources,
        from_cache: true,
      };
    }
  }

  const { metrics, sources, from_cache } = await resolveStockMetrics(symbol, refresh);
  const est = estimate(metrics);
  const composite = est.quality_score ?? 0;
  const verifyScore = Math.round(Math.max(0, Math.min(56, composite * 56 / 100)));
  const mos = est.mos ?? 0;
  const analysis = {
    ...est,
    composite_score: composite,
    verify_score: verifyScore,
    recommendation: matrixVerdict(verifyScore, mos),
  };

  if (!refresh || !from_cache) {
    await cacheSetJson(
      verifyKey,
      {
        metrics,
        analysis,
        sources,
        cached_at: new Date().toISOString(),
      } satisfies VerifyCachePayload,
      getCacheTtl().verify,
    ).catch(() => undefined);
  }

  return { metrics, analysis, sources, from_cache };
}

async function applyPromoterHolding(metrics: StockMetrics): Promise<StockMetrics> {
  const sym = String(metrics.symbol ?? '').toUpperCase();
  if (!sym) return metrics;
  try {
    const row = await prisma.promoterHolding.findUnique({ where: { symbol: sym } });
    if (!row) return metrics;
    return {
      ...metrics,
      promoter_holding: row.holdingPct,
      promoter_holding_source: row.source,
      promoter_holding_as_of: row.asOf.toISOString().slice(0, 10),
    };
  } catch {
    return metrics;
  }
}

export async function screenStock(symbol: string, refresh = false): Promise<ScreenerRow> {
  const { metrics } = await resolveStockMetrics(symbol, refresh);
  return screenSymbol(symbol, metrics);
}

export async function runLiveScreener(
  symbols: string[],
  preset?: string,
  customFilters: ScreenerFilters = {},
  onProgress?: (progress: { processed: number; total: number; passed: number }) => void | Promise<void>,
): Promise<ScreenerRow[]> {
  const filters = { ...(preset ? PRESET_FILTERS[preset] ?? {} : {}), ...customFilters };
  const rows: ScreenerRow[] = [];

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    const row = await screenStock(sym);
    if (passesFilters(row, filters)) {
      rows.push(row);
    }
    await onProgress?.({ processed: i + 1, total: symbols.length, passed: rows.length });
  }

  return rows.sort((a, b) => (b.mos ?? -999) - (a.mos ?? -999));
}
