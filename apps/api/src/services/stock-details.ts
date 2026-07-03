import {
  fetchDailyBars,
  fetchScreenerProfile,
  ivDriftHint,
  refreshStockSymbol,
  resolveStockMetrics,
  verifyStock,
  type ScreenerProfile,
} from '@sv/data-adapters';
import { screenSymbol } from '@sv/core';
import {
  buildDailyChartPayload,
  chartPhaseAnalysis,
  enrichDetailTa,
  mergeTaFundamentalFallback,
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
  const normalized = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  const [metricsResult, verifyResult] = await Promise.all([
    resolveStockMetrics(normalized, refresh),
    verifyStock(normalized, refresh),
  ]);

  const { metrics, sources, from_cache } = metricsResult;
  const { analysis } = verifyResult;

  if ((metrics.price ?? 0) <= 0 && sources.includes('sample_fallback')) {
    throw new Error(`Could not load market data for ${normalized}`);
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
    symbol: String(metrics.symbol ?? normalized),
    name: String(metrics.name ?? verifyResult.company_name ?? metrics.symbol ?? normalized),
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

export async function getStockChart(
  symbol: string,
  refresh = false,
  fundamentals: { price?: number; high_52w?: number; low_52w?: number } = {},
): Promise<StockChartResponse> {
  const normalized = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  let fund = fundamentals;
  if (!fund.price && !fund.high_52w && !fund.low_52w) {
    const { metrics } = await resolveStockMetrics(normalized, refresh);
    fund = {
      price: Number(metrics.price ?? 0),
      high_52w: Number(metrics.high_52w ?? 0),
      low_52w: Number(metrics.low_52w ?? 0),
    };
  }

  const bars = await fetchDailyBars(normalized, refresh);
  if (bars.length < 30) {
    const ta = mergeTaFundamentalFallback({ ta_ready: false }, fund);
    return {
      symbol: normalized,
      chart: null,
      ta,
      phases: chartPhaseAnalysis(Number(fund.price ?? 0), ta, null),
      from_cache: !refresh,
    };
  }

  const chart = buildDailyChartPayload(bars, normalized);
  const price = bars[bars.length - 1].close;
  const ta = mergeTaFundamentalFallback(enrichDetailTa(bars, price), {
    price: fund.price ?? price,
    high_52w: fund.high_52w,
    low_52w: fund.low_52w,
  });
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
