import {
  fetchDailyBars,
  fetchScreenerProfile,
  ivDriftHint,
  refreshStockSymbol,
  verifyStock,
  type ScreenerProfile,
} from '@sv/data-adapters';
import { screenSymbol } from '@sv/core';
import {
  buildDailyChartPayload,
  chartPhaseAnalysis,
  enrichDetailTa,
  type ChartPhaseAnalysis,
  type DailyChartPayload,
  type TaMetrics,
} from '@sv/swing';

const DISCLAIMER =
  'Research tool only — not SEBI-registered investment advice. Chart phases are timing context only.';

function valuationFromAnalysis(analysis: Record<string, unknown>) {
  const a = analysis as {
    intrinsic?: number;
    mos?: number | null;
    zone?: string;
    fair_pe?: number;
    quality_score?: number;
    recommendation?: string;
    final_rating?: string;
    graham?: number;
    method?: string;
    composite_score?: number;
    verify_score?: number;
  };
  return {
    intrinsic: a.intrinsic ?? 0,
    mos: a.mos ?? null,
    zone: a.zone ?? '',
    fair_pe: a.fair_pe ?? 0,
    quality_score: a.quality_score ?? 0,
    composite_score: a.composite_score ?? a.quality_score ?? 0,
    verify_score: a.verify_score ?? 0,
    recommendation: a.recommendation ?? '',
    final_rating: a.final_rating ?? a.recommendation ?? '',
    graham: a.graham ?? 0,
    method: a.method ?? '',
  };
}

export async function getStockSummary(symbol: string, refresh = false) {
  const { metrics, analysis, sources, from_cache } = await verifyStock(symbol, refresh);

  if ((metrics.price ?? 0) <= 0 && sources.includes('sample_fallback')) {
    throw new Error(`Could not load market data for ${symbol.toUpperCase()}`);
  }

  const valuation = valuationFromAnalysis(analysis as Record<string, unknown>);
  let iv_drift = null;
  try {
    const screenerRow = screenSymbol(String(metrics.symbol ?? symbol), metrics);
    iv_drift = ivDriftHint(Number(screenerRow.intrinsic ?? 0), valuation.intrinsic);
  } catch {
    iv_drift = null;
  }

  return {
    symbol: String(metrics.symbol ?? symbol).toUpperCase(),
    name: String(metrics.name ?? metrics.symbol ?? symbol),
    success: true,
    metrics,
    valuation,
    sources,
    from_cache,
    iv_drift,
    educational_only: true,
    disclaimer: DISCLAIMER,
  };
}

export interface StockChartResponse {
  symbol: string;
  chart: DailyChartPayload | null;
  ta: TaMetrics;
  phases: ChartPhaseAnalysis;
  from_cache: boolean;
}

export async function getStockChart(symbol: string, refresh = false): Promise<StockChartResponse> {
  const normalized = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  const bars = await fetchDailyBars(normalized, refresh);
  if (bars.length < 50) {
    return {
      symbol: normalized,
      chart: null,
      ta: { ta_ready: false },
      phases: chartPhaseAnalysis(0, { ta_ready: false }, null),
      from_cache: !refresh,
    };
  }

  const chart = buildDailyChartPayload(bars, normalized);
  const price = bars[bars.length - 1].close;
  const ta = enrichDetailTa(bars, price);
  const phases = chartPhaseAnalysis(price, ta, chart);

  return {
    symbol: normalized,
    chart,
    ta,
    phases,
    from_cache: !refresh,
  };
}

export async function getStockProfile(
  symbol: string,
  refresh = false,
): Promise<{ symbol: string; profile: ScreenerProfile | null }> {
  const normalized = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  const profile = await fetchScreenerProfile(normalized, 'consolidated', refresh);
  return { symbol: normalized, profile };
}

export async function refreshStockCaches(symbol: string) {
  return refreshStockSymbol(symbol);
}
