import { passesFilters, passesTableGates, PRESET_FILTERS, screenSymbol, buildStockMetrics, type ScreenerFilters } from '@sv/core';
import type { ScreenerRow, StockMetrics } from '@sv/shared';
import { CACHE_PREFIX, getCacheTtl } from '@sv/shared';
import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { prisma } from '@sv/db';
import {
  enrichDetailTa,
  passesTaFilters,
  taFieldsForRow,
  taFiltersActive,
} from '@sv/swing';
import { runCfaAutoVerify } from './cfa-auto-verify.js';
import { fetchScreenerAnnualFinancials } from './screener-annual.js';
import { fetchScreenerRatios } from './screener-in.js';
import { enrichStockMetrics } from './stock-metrics-enrich.js';
import { fetchStockData } from './stock-data-fetcher.js';
import { getPromoterHolding } from './promoter-holding.js';
import { filterUnrestrictedSymbols } from './exchange-list-loader.js';
import { fetchDailyBars } from './swing-chart.js';

export type { ScreenerFilters };

const SCREENER_CONCURRENCY = 6;

export interface ScreenerRunOptions {
  refresh?: boolean;
  concurrency?: number;
  exclude_restricted?: boolean;
}

export interface ScreenerRunResult {
  rows: ScreenerRow[];
  restricted_skipped: number;
  cache_hits: number;
  exchange_list_as_of: string;
  scanned: number;
}

function shouldEnrichTa(filters: ScreenerFilters): boolean {
  return Boolean(filters.show_ta || filters.ta_preset || taFiltersActive(filters));
}

async function applyTaGates(
  symbol: string,
  row: ScreenerRow,
  filters: ScreenerFilters,
  refresh: boolean,
): Promise<ScreenerRow | null> {
  if (!shouldEnrichTa(filters)) return row;

  const bars = await fetchDailyBars(symbol, refresh);
  if (!bars.length) {
    return taFiltersActive(filters) ? null : row;
  }

  const ta = enrichDetailTa(bars, row.price);
  if (taFiltersActive(filters) && !passesTaFilters(ta, filters)) {
    return null;
  }

  return { ...row, ...taFieldsForRow(ta) } as ScreenerRow;
}

function presetCacheKey(preset?: string): string {
  return preset?.trim() || 'custom';
}

function usefulValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') return value.trim() !== '';
  return value !== null && value !== undefined;
}

function hasIncompleteCoreFundamentals(metrics: StockMetrics): boolean {
  return (
    Number(metrics.market_cap_cr ?? 0) <= 0 ||
    Number(metrics.pe ?? 0) <= 0 ||
    Number(metrics.eps ?? 0) <= 0 ||
    Number(metrics.roe ?? 0) <= 0 ||
    Number(metrics.roce ?? 0) <= 0
  );
}

async function cacheResolvedStockMetrics(
  symbol: string,
  metrics: StockMetrics,
  sources: string[],
): Promise<void> {
  if (hasIncompleteCoreFundamentals(metrics)) return;
  const baseSymbol = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  await cacheSetJson(
    cacheKey(CACHE_PREFIX.STOCK, baseSymbol),
    {
      success: true,
      symbol: baseSymbol,
      company_name: String(metrics.name ?? baseSymbol),
      sources: [...new Set(sources)],
      metrics,
      from_cache: false,
    },
    getCacheTtl().stock,
  ).catch(() => undefined);
}

function mergeMissingFundamentals(symbol: string, metrics: StockMetrics): StockMetrics {
  const fallback = buildStockMetrics(symbol);
  const merged: StockMetrics = { ...fallback, symbol: String(metrics.symbol ?? fallback.symbol ?? symbol) };
  for (const [key, value] of Object.entries(metrics)) {
    if (key === 'symbol') continue;
    if (usefulValue(value)) {
      merged[key] = value;
    }
  }
  if (Number(metrics.price ?? 0) > 0) {
    merged.price = metrics.price;
  }
  if (!usefulValue(metrics.name) || String(metrics.name).toUpperCase() === symbol.toUpperCase()) {
    merged.name = String(fallback.name ?? metrics.name ?? symbol);
  }
  return merged;
}

export async function resolveStockMetrics(
  symbol: string,
  refresh = false,
): Promise<{ metrics: StockMetrics; sources: string[]; from_cache: boolean }> {
  const baseSymbol = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  const [fetched, annual, screener] = await Promise.all([
    fetchStockData(symbol, { refresh }),
    fetchScreenerAnnualFinancials(baseSymbol, refresh),
    fetchScreenerRatios(baseSymbol, refresh),
  ]);

  if (fetched.success && fetched.metrics) {
    const usedFundamentalFallback = hasIncompleteCoreFundamentals(fetched.metrics);
    let metrics = usedFundamentalFallback
      ? mergeMissingFundamentals(baseSymbol, fetched.metrics)
      : fetched.metrics;
    metrics = enrichStockMetrics(metrics, annual, {
      symbol: baseSymbol,
      div_yield: screener?.div_yield,
    });
    metrics = await applyPromoterHolding(metrics);

    const sources = [...fetched.sources];
    if (annual?.revenue_history?.length) sources.push('Screener.in (annual P&L)');
    if (usedFundamentalFallback && hasIncompleteCoreFundamentals(fetched.metrics)) {
      sources.push('sample_fallback (incomplete live fundamentals)');
    }
    const uniqueSources = [...new Set(sources)];
    await cacheResolvedStockMetrics(baseSymbol, metrics, uniqueSources);

    return {
      metrics,
      sources: uniqueSources,
      from_cache: Boolean(fetched.from_cache) && !refresh,
    };
  }

  return {
    metrics: buildStockMetrics(symbol),
    sources: ['sample_fallback'],
    from_cache: false,
  };
}

export async function verifyStock(symbol: string, refresh = false) {
  const result = await runCfaAutoVerify(symbol, refresh);
  return {
    symbol: result.symbol,
    success: result.success,
    company_name: result.company_name,
    metrics: result.metrics,
    analysis: result.analysis,
    memo: result.memo,
    assumptions: result.assumptions,
    screening_mode: result.screening_mode,
    sources: result.sources,
    from_cache: result.from_cache,
  };
}

async function applyPromoterHolding(metrics: StockMetrics): Promise<StockMetrics> {
  const sym = String(metrics.symbol ?? '').toUpperCase();
  if (!sym) return metrics;

  let out: StockMetrics = { ...metrics };

  const file = getPromoterHolding(sym);
  if (file) {
    out = {
      ...out,
      promoter_holding: file.pct,
      promoter_holding_source: file.source,
      ...(file.as_of ? { promoter_holding_as_of: file.as_of } : {}),
    };
  }

  try {
    const row = await prisma.promoterHolding.findUnique({ where: { symbol: sym } });
    if (row) {
      out = {
        ...out,
        promoter_holding: row.holdingPct,
        promoter_holding_source: row.source,
        promoter_holding_as_of: row.asOf.toISOString().slice(0, 10),
      };
    }
  } catch {
    /* DB optional in dev */
  }

  return out;
}

export async function screenStock(symbol: string, refresh = false): Promise<ScreenerRow> {
  const { metrics } = await resolveStockMetrics(symbol, refresh);
  return screenSymbol(symbol, metrics);
}

async function screenSymbolFiltered(
  symbol: string,
  filters: ScreenerFilters,
  presetKey: string,
  refresh = false,
  cacheHits?: { count: number },
): Promise<ScreenerRow | null> {
  const baseSymbol = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  const rowCacheKey = cacheKey(CACHE_PREFIX.SCREENER_ROW, `${presetKey}:${baseSymbol}`);

  if (!refresh) {
    const cached = await cacheGetJson<ScreenerRow>(rowCacheKey);
    if (cached && passesFilters(cached, filters)) {
      if (!shouldEnrichTa(filters) || cached.ta_ready) {
        if (cacheHits) cacheHits.count++;
        return cached;
      }
    }
  }

  const ratios = await fetchScreenerRatios(baseSymbol, refresh);
  if (
    ratios &&
    !passesTableGates(
      {
        roce: ratios.roce,
        roe: ratios.roe,
        pe: ratios.pe,
        sales_yoy: ratios.sales_yoy,
        market_cap_cr: ratios.market_cap_cr,
        div_yield: ratios.div_yield,
      },
      filters,
    )
  ) {
    return null;
  }

  let row = await screenStock(symbol, refresh);
  if (!passesFilters(row, filters)) return null;

  const enriched = await applyTaGates(symbol, row, filters, refresh);
  if (!enriched) return null;
  row = enriched;

  if (!refresh) {
    await cacheSetJson(rowCacheKey, row, getCacheTtl().screener_row);
  }
  return row;
}

export async function runLiveScreener(
  symbols: string[],
  preset?: string,
  customFilters: ScreenerFilters = {},
  onProgress?: (progress: { processed: number; total: number; passed: number }) => void | Promise<void>,
  options: ScreenerRunOptions = {},
): Promise<ScreenerRunResult> {
  const filters = { ...(preset ? (PRESET_FILTERS[preset] ?? {}) : {}), ...customFilters };
  const refresh = options.refresh ?? false;
  const concurrency = options.concurrency ?? SCREENER_CONCURRENCY;
  const presetKey = presetCacheKey(preset);

  const restricted =
    options.exclude_restricted === false
      ? { symbols, restricted_skipped: 0, exchange_list_as_of: '' }
      : filterUnrestrictedSymbols(symbols);

  const working = restricted.symbols;
  const rows: ScreenerRow[] = [];
  const cacheHits = { count: 0 };
  const total = working.length;

  for (let start = 0; start < total; start += concurrency) {
    const batch = working.slice(start, start + concurrency);
    const batchResults = await Promise.all(
      batch.map((sym) => screenSymbolFiltered(sym, filters, presetKey, refresh, cacheHits)),
    );
    for (const row of batchResults) {
      if (row) rows.push(row);
    }
    await onProgress?.({
      processed: Math.min(start + batch.length, total),
      total,
      passed: rows.length,
    });
  }

  return {
    rows: rows.sort((a, b) => (b.mos ?? -999) - (a.mos ?? -999)),
    restricted_skipped: restricted.restricted_skipped,
    cache_hits: cacheHits.count,
    exchange_list_as_of: restricted.exchange_list_as_of,
    scanned: total,
  };
}
