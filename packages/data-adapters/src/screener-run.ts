import { analyzeSymbol, buildStockMetrics, passesFilters, PRESET_FILTERS, screenSymbol } from '@sv/core';
import type { ScreenerRow, StockMetrics } from '@sv/shared';
import { fetchStockData } from './stock-data-fetcher.js';

export type ScreenerFilters = {
  min_roe?: number;
  min_roce?: number;
  min_mos?: number;
  max_pe?: number;
};

export async function resolveStockMetrics(
  symbol: string,
  refresh = false,
): Promise<{ metrics: StockMetrics; sources: string[]; from_cache: boolean }> {
  const fetched = await fetchStockData(symbol, { refresh });
  if (fetched.success && fetched.metrics) {
    return {
      metrics: fetched.metrics,
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
  const { metrics, sources, from_cache } = await resolveStockMetrics(symbol, refresh);
  const analysis = analyzeSymbol(metrics);
  return { metrics, analysis, sources, from_cache };
}

export async function screenStock(symbol: string, refresh = false): Promise<ScreenerRow> {
  const { metrics } = await resolveStockMetrics(symbol, refresh);
  return screenSymbol(symbol, metrics);
}

export async function runLiveScreener(
  symbols: string[],
  preset?: string,
  customFilters: ScreenerFilters = {},
): Promise<ScreenerRow[]> {
  const filters = { ...(preset ? PRESET_FILTERS[preset] ?? {} : {}), ...customFilters };
  const rows: ScreenerRow[] = [];

  for (const sym of symbols) {
    const row = await screenStock(sym);
    if (passesFilters(row, filters)) {
      rows.push(row);
    }
  }

  return rows.sort((a, b) => (b.mos ?? -999) - (a.mos ?? -999));
}
