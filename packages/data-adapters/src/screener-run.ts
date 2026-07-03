import { buildStockMetrics, passesFilters, PRESET_FILTERS, screenSymbol } from '@sv/core';
import type { ScreenerRow, StockMetrics } from '@sv/shared';
import { prisma } from '@sv/db';
import { runCfaAutoVerify } from './cfa-auto-verify.js';
import { fetchScreenerAnnualFinancials } from './screener-annual.js';
import { fetchScreenerRatios } from './screener-in.js';
import { enrichStockMetrics } from './stock-metrics-enrich.js';
import { fetchStockData } from './stock-data-fetcher.js';
import { getPromoterHolding } from './promoter-holding.js';

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
  const baseSymbol = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  const [fetched, annual, screener] = await Promise.all([
    fetchStockData(symbol, { refresh }),
    fetchScreenerAnnualFinancials(baseSymbol, refresh),
    fetchScreenerRatios(baseSymbol, refresh),
  ]);

  if (fetched.success && fetched.metrics) {
    let metrics = enrichStockMetrics(fetched.metrics, annual, {
      symbol: baseSymbol,
      div_yield: screener?.div_yield,
    });
    metrics = await applyPromoterHolding(metrics);

    const sources = [...fetched.sources];
    if (annual?.revenue_history?.length) sources.push('Screener.in (annual P&L)');

    return {
      metrics,
      sources: [...new Set(sources)],
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
