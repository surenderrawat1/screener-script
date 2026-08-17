import {
  passesFilters,
  passesTableGates,
  screenSymbol,
  buildStockMetrics,
  hasFundamentalTableFloor,
  prioritizeUniverseTable,
  tablePriorityScore,
  rowNeedsBulkEnrichment,
  passesRecommendationFilter,
  resolveRecommendationFilter,
  type ScreenerFilters,
} from '@sv/core';
import type { ScreenerRow, StockMetrics } from '@sv/shared';
import { CACHE_PREFIX, getCacheTtl } from '@sv/shared';
import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { prisma } from '@sv/db';
import {
  attachHourlyPriceCrossMetrics,
  enrichDetailTa,
  needsHourlyTaFilters,
  passesTaFilters,
  taFieldsForRow,
  taFiltersActive,
  type TaMetrics,
} from '@sv/swing';
import { runCfaAutoVerify } from './cfa-auto-verify.js';
import { fetchScreenerAnnualFinancials } from './screener-annual.js';
import { fetchScreenerRatios, type ScreenerRatios } from './screener-in.js';
import {
  buildBulkLookupForSymbols,
  mergeRatiosWithBulk,
  type ScreenerBulkRow,
} from './screener-bulk-table.js';
import { enrichStockMetrics } from './stock-metrics-enrich.js';
import { fetchStockData } from './stock-data-fetcher.js';
import { getPromoterHolding } from './promoter-holding.js';
import { resolvePromoterPledge } from './promoter-pledge.js';
import { filterUnrestrictedSymbols } from './exchange-list-loader.js';
import { fetchDailyBars, fetchHourlyBars } from './swing-chart.js';
import { attachScreenerParityHint } from './screener-parity-hint.js';
import { resolveScreenerPresetFilters } from './screener-preset-resolve.js';

export type { ScreenerFilters };

const SCREENER_CONCURRENCY = 8;
const PRIORITIZE_MIN_SYMBOLS = 20;
const PRIORITIZE_CONCURRENCY = 12;

export interface ScreenerRunOptions {
  refresh?: boolean;
  concurrency?: number;
  exclude_restricted?: boolean;
  recommendation_filter?: string;
  user_id?: string;
}

export interface ScreenerRunResult {
  rows: ScreenerRow[];
  restricted_skipped: number;
  cache_hits: number;
  exchange_list_as_of: string;
  scanned: number;
  table_prefilter_skipped: number;
  stock_cache_hits: number;
  full_analyzed: number;
}

interface ScreenerRunStats {
  table_prefilter_skipped: number;
  stock_cache_hits: number;
  full_analyzed: number;
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

  let ta = enrichDetailTa(bars, row.price);
  if (needsHourlyTaFilters(filters)) {
    const hourly = await fetchHourlyBars(symbol, refresh);
    if (!hourly.length) {
      return taFiltersActive(filters) ? null : { ...row, ...taFieldsForRow(ta) } as ScreenerRow;
    }
    ta = attachHourlyPriceCrossMetrics(ta, hourly);
  }
  if (taFiltersActive(filters) && !passesTaFilters(ta, filters)) {
    return null;
  }

  return { ...row, ...taFieldsForRow(ta) } as ScreenerRow;
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

function hasScreenerFundamentals(ratios: ScreenerRatios | null | undefined): boolean {
  if (!ratios) return false;
  const hasQuality = ratios.roce > 0 || ratios.roe > 0;
  const hasValuation = ratios.pe > 0 || ratios.market_cap_cr > 0;
  return hasQuality && hasValuation;
}

/** Build CFA-ready metrics when Yahoo fails but Screener.in ratios (+ price) are available. */
export function buildMetricsFromScreenerFallback(
  baseSymbol: string,
  ratios: ScreenerRatios,
  price: number,
  name?: string,
): StockMetrics {
  let metrics: StockMetrics = {
    symbol: baseSymbol,
    name: name ?? baseSymbol,
    price,
    pe: 0,
    eps: 0,
    roe: 0,
    roce: 0,
    market_cap_cr: 0,
  };
  metrics = mergeScreenerRatiosIntoMetrics(metrics, ratios);
  const pe = Number(metrics.pe ?? 0);
  const px = Number(metrics.price ?? 0);
  if (Number(metrics.eps ?? 0) <= 0 && pe > 0 && px > 0) {
    metrics.eps = Math.round((px / pe) * 100) / 100;
  }
  return metrics;
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


export function mergeScreenerRatiosIntoMetrics(
  metrics: StockMetrics,
  ratios: ScreenerRatios | null | undefined,
): StockMetrics {
  if (!ratios) return metrics;
  const out: StockMetrics = { ...metrics };
  if (Number(out.roce ?? 0) <= 0 && ratios.roce > 0) out.roce = ratios.roce;
  if (Number(out.roe ?? 0) <= 0 && ratios.roe > 0) out.roe = ratios.roe;
  if (Number(out.pe ?? 0) <= 0 && ratios.pe > 0) out.pe = ratios.pe;
  if (Number(out.book_value ?? 0) <= 0 && ratios.book_value > 0) out.book_value = ratios.book_value;
  if (Number(out.market_cap_cr ?? 0) <= 0 && ratios.market_cap_cr > 0) out.market_cap_cr = ratios.market_cap_cr;
  if ((out.sales_yoy ?? 0) === 0 && ratios.sales_yoy !== 0) out.sales_yoy = ratios.sales_yoy;
  if ((out.profit_yoy ?? 0) === 0 && ratios.profit_yoy !== 0) out.profit_yoy = ratios.profit_yoy;
  if ((out.debt_to_equity ?? 0) === 0 && ratios.debt_to_equity > 0) out.debt_to_equity = ratios.debt_to_equity;
  if ((out.div_yield ?? 0) === 0 && (ratios.div_yield ?? 0) > 0) out.div_yield = ratios.div_yield;
  const price = Number(out.price ?? 0);
  const pe = Number(out.pe ?? 0);
  if (Number(out.eps ?? 0) <= 0 && price > 0 && pe > 0) out.eps = price / pe;
  return out;
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
    let metrics = mergeScreenerRatiosIntoMetrics(fetched.metrics, screener);
    const incompleteAfterScreener = hasIncompleteCoreFundamentals(metrics);
    if (incompleteAfterScreener) {
      metrics = mergeMissingFundamentals(baseSymbol, metrics);
    }
    metrics = enrichStockMetrics(metrics, annual, {
      symbol: baseSymbol,
      div_yield: screener?.div_yield,
    });
    metrics = await applyPromoterHolding(metrics);
    metrics = await applyPromoterPledge(metrics);

    const sources = [...fetched.sources];
    if (screener && (screener.roce > 0 || screener.roe > 0)) {
      sources.push('Screener.in (ratios)');
    }
    if (annual?.revenue_history?.length) sources.push('Screener.in (annual P&L)');
    if (hasIncompleteCoreFundamentals(metrics)) {
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

  if (screener && hasScreenerFundamentals(screener)) {
    let ratios = screener;
    const bulkMap = await buildBulkLookupForSymbols([baseSymbol], 5, refresh);
    const bulk = bulkMap.get(baseSymbol);
    if (bulk) {
      ratios = mergeRatiosWithBulk(ratios, bulk);
    }

    let price = bulk?.price ?? 0;
    const sources: string[] = ['Screener.in (ratios)'];
    if (bulk?.price) sources.push('Screener.in (bulk table)');

    if (price <= 0) {
      const bars = await fetchDailyBars(symbol, refresh);
      const lastClose = bars.length ? Number(bars[bars.length - 1]?.close ?? 0) : 0;
      if (lastClose > 0) {
        price = lastClose;
        sources.push('Chart (daily close)');
      }
    }

    if (price > 0) {
      let metrics = buildMetricsFromScreenerFallback(baseSymbol, ratios, price, bulk?.name);
      if (hasIncompleteCoreFundamentals(metrics)) {
        metrics = mergeMissingFundamentals(baseSymbol, metrics);
      }
      metrics = enrichStockMetrics(metrics, annual, {
        symbol: baseSymbol,
        div_yield: ratios.div_yield,
      });
      metrics = await applyPromoterHolding(metrics);
      metrics = await applyPromoterPledge(metrics);

      if (annual?.revenue_history?.length) sources.push('Screener.in (annual P&L)');
      if (fetched.error) sources.push('Screener.in only (Yahoo unavailable)');
      if (hasIncompleteCoreFundamentals(metrics)) {
        sources.push('sample_fallback (incomplete live fundamentals)');
      }

      const uniqueSources = [...new Set(sources)];
      await cacheResolvedStockMetrics(baseSymbol, metrics, uniqueSources);

      return {
        metrics,
        sources: uniqueSources,
        from_cache: false,
      };
    }
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
    annual_report: result.annual_report,
    data_quality: result.data_quality,
  };
}


async function applyPromoterPledge(metrics: StockMetrics): Promise<StockMetrics> {
  const sym = String(metrics.symbol ?? '').toUpperCase().replace(/\.(NS|BO)$/, '');
  if (!sym) return metrics;

  const overlay = await resolvePromoterPledge(sym);
  if (!overlay) return metrics;

  // Warehouse / upload / file overlay wins over Screener.in scrape for Phase 1.6 honesty.
  return {
    ...metrics,
    promoter_pledge: overlay.pct,
    promoter_pledge_as_of: overlay.as_of || String(metrics.promoter_pledge_as_of ?? ''),
    promoter_pledge_source: overlay.source,
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

async function loadCachedStockMetrics(baseSymbol: string): Promise<StockMetrics | null> {
  const cached = await cacheGetJson<{ metrics?: StockMetrics }>(
    cacheKey(CACHE_PREFIX.STOCK, baseSymbol),
  );
  if (cached?.metrics && !hasIncompleteCoreFundamentals(cached.metrics)) {
    return cached.metrics;
  }
  return null;
}

async function prioritizeSymbolsByTable(
  symbols: string[],
  filters: ScreenerFilters,
  refresh: boolean,
): Promise<string[]> {
  if (symbols.length < PRIORITIZE_MIN_SYMBOLS || !hasFundamentalTableFloor(filters)) {
    return symbols;
  }

  const scored: Array<{ symbol: string; score: number }> = [];
  for (let start = 0; start < symbols.length; start += PRIORITIZE_CONCURRENCY) {
    const batch = symbols.slice(start, start + PRIORITIZE_CONCURRENCY);
    const batchScored = await Promise.all(
      batch.map(async (symbol) => {
        const ratios = await fetchScreenerRatios(symbol, refresh);
        return {
          symbol,
          score: ratios ? tablePriorityScore(ratios) : -999,
        };
      }),
    );
    scored.push(...batchScored);
  }

  return prioritizeUniverseTable(scored).map((row) => row.symbol);
}


async function withParityHint(row: ScreenerRow, symbol: string): Promise<ScreenerRow> {
  return attachScreenerParityHint(row, symbol);
}

function bulkPagesForBatch(batchSize: number): number {
  return Math.min(5, Math.max(1, Math.ceil(batchSize / 40)));
}

async function prefetchBulkForBatch(
  symbols: string[],
  refresh: boolean,
): Promise<Map<string, ScreenerBulkRow>> {
  if (!symbols.length) return new Map();
  return buildBulkLookupForSymbols(symbols, bulkPagesForBatch(symbols.length), refresh);
}

async function screenSymbolFiltered(
  symbol: string,
  filters: ScreenerFilters,
  presetKey: string,
  refresh = false,
  cacheHits?: { count: number },
  stats?: ScreenerRunStats,
  recommendationFilter = '',
  bulkPrefetch?: Map<string, ScreenerBulkRow>,
): Promise<ScreenerRow | null> {
  const passesRec = (candidate: ScreenerRow) =>
    passesRecommendationFilter(candidate, recommendationFilter, filters.recommendation_tiers);
  const baseSymbol = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  const rowCacheKey = cacheKey(CACHE_PREFIX.SCREENER_ROW, `${presetKey}:${baseSymbol}`);

  if (!refresh) {
    const cached = await cacheGetJson<ScreenerRow>(rowCacheKey);
    if (cached && passesFilters(cached, filters) && passesRec(cached)) {
      if (!shouldEnrichTa(filters)) {
        if (cacheHits) cacheHits.count++;
        return withParityHint(cached, symbol);
      }
      // Only reuse TA-ready rows that still pass *these* TA gates.
      // (Daily enrich cache must not satisfy a later hourly cross filter.)
      if (
        cached.ta_ready &&
        passesRec(cached) &&
        (!taFiltersActive(filters) || passesTaFilters(cached as unknown as TaMetrics, filters))
      ) {
        if (cacheHits) cacheHits.count++;
        return withParityHint(cached, symbol);
      }
    }
  }

  let ratios = await fetchScreenerRatios(baseSymbol, refresh);
  if (ratios && rowNeedsBulkEnrichment(ratios)) {
    const bulk =
      bulkPrefetch?.get(baseSymbol) ??
      (await buildBulkLookupForSymbols([baseSymbol], 5, refresh)).get(baseSymbol);
    if (bulk) ratios = mergeRatiosWithBulk(ratios, bulk);
  }

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
    if (stats) stats.table_prefilter_skipped++;
    return null;
  }

  let row: ScreenerRow;
  const cachedMetrics = !refresh ? await loadCachedStockMetrics(baseSymbol) : null;
  if (cachedMetrics) {
    if (stats) stats.stock_cache_hits++;
    row = screenSymbol(symbol, cachedMetrics);
  } else {
    if (stats) stats.full_analyzed++;
    row = await screenStock(symbol, refresh);
  }
  if (!passesFilters(row, filters)) return null;

  const enriched = await applyTaGates(symbol, row, filters, refresh);
  if (!enriched) return null;
  row = enriched;

  if (!passesRec(row)) {
    return null;
  }

  row = await withParityHint(row, symbol);

  if (!refresh) {
    await cacheSetJson(rowCacheKey, row, getCacheTtl().screener_row);
  }
  return row;
}

export async function runLiveScreener(
  symbols: string[],
  preset?: string,
  customFilters: ScreenerFilters = {},
  onProgress?: (
    progress: {
      processed: number;
      total: number;
      passed: number;
      recent_symbols?: string[];
      recent_passed_symbols?: string[];
    },
  ) => void | Promise<void>,
  options: ScreenerRunOptions = {},
): Promise<ScreenerRunResult> {
  const resolved = await resolveScreenerPresetFilters(preset, options.user_id);
  const filters = { ...resolved.baseFilters, ...customFilters };
  const recommendationFilter = resolveRecommendationFilter(
    options.recommendation_filter,
    preset,
    filters,
  );
  const refresh = options.refresh ?? false;
  const concurrency = options.concurrency ?? SCREENER_CONCURRENCY;
  const presetKey = resolved.presetKey;

  const restricted =
    options.exclude_restricted === false
      ? { symbols, restricted_skipped: 0, exchange_list_as_of: '' }
      : filterUnrestrictedSymbols(symbols);

  const working = await prioritizeSymbolsByTable(restricted.symbols, filters, refresh);
  const rows: ScreenerRow[] = [];
  const cacheHits = { count: 0 };
  const stats: ScreenerRunStats = {
    table_prefilter_skipped: 0,
    stock_cache_hits: 0,
    full_analyzed: 0,
  };
  const total = working.length;

  for (let start = 0; start < total; start += concurrency) {
    const batch = working.slice(start, start + concurrency);
    const bulkPrefetch = await prefetchBulkForBatch(
      batch.map((sym) => sym.trim().toUpperCase().replace(/\.(NS|BO)$/, '')),
      refresh,
    );
    const batchResults = await Promise.all(
      batch.map((sym) =>
        screenSymbolFiltered(
          sym,
          filters,
          presetKey,
          refresh,
          cacheHits,
          stats,
          recommendationFilter,
          bulkPrefetch,
        ),
      ),
    );
    for (const row of batchResults) {
      if (row) rows.push(row);
    }

    const recentSymbols = batchResults.map((r) => r?.symbol).filter(Boolean) as string[];
    const recentPassedSymbols = batchResults.filter((r): r is ScreenerRow => Boolean(r)).map((r) => r.symbol);
    await onProgress?.({
      processed: Math.min(start + batch.length, total),
      total,
      passed: rows.length,
      recent_symbols: recentSymbols.slice(0, 20),
      recent_passed_symbols: recentPassedSymbols.slice(0, 20),
    });
  }

  return {
    rows: rows.sort((a, b) => (b.mos ?? -999) - (a.mos ?? -999)),
    restricted_skipped: restricted.restricted_skipped,
    cache_hits: cacheHits.count,
    exchange_list_as_of: restricted.exchange_list_as_of,
    scanned: total,
    table_prefilter_skipped: stats.table_prefilter_skipped,
    stock_cache_hits: stats.stock_cache_hits,
    full_analyzed: stats.full_analyzed,
  };
}
