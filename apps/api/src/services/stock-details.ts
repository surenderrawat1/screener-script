import {
  fetchDailyBars,
  fetchScreenerProfile,
  resolveStockMetrics,
  type ScreenerProfile,
} from '@sv/data-adapters';
import { cacheClearSymbol } from '@sv/cache';
import { screenSymbol, screeningScoreFromQuality } from '@sv/core';
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

function fallbackProfileFromMetrics(symbol: string, metrics: Record<string, unknown>): ScreenerProfile {
  const period = 'Latest available';
  const item = (label: string, value: unknown) => ({
    label,
    latest_period: period,
    latest_cr: Number.isFinite(Number(value)) && Number(value) !== 0 ? Number(value) : null,
    history: { [period]: Number.isFinite(Number(value)) && Number(value) !== 0 ? Number(value) : null },
  });
  const items = [
    item('Cash from Operating Activity', metrics.cfo_cr),
    item('Free Cash Flow', metrics.fcf_cr),
    item('Estimated Capex', metrics.capex_cr),
    item('Total Debt', metrics.total_debt_cr),
    item('Total Cash', metrics.total_cash_cr),
  ].filter((row) => row.latest_cr !== null);

  const name = String(metrics.name ?? symbol);
  const sector = String(metrics.sector ?? 'general');
  const industry = String(metrics.industry ?? '');
  return {
    about: `${name} profile fallback generated from available fundamentals because Screener.in profile data is unavailable.`,
    key_points: [
      `Sector: ${sector}`,
      industry ? `Industry: ${industry}` : '',
      `ROE ${metrics.roe ?? '—'}%, ROCE ${metrics.roce ?? '—'}%, Debt/Equity ${metrics.debt_to_equity ?? '—'}`,
    ]
      .filter(Boolean)
      .join(' · '),
    website: '',
    bse_code: '',
    nse_symbol: symbol,
    concalls: [],
    expenditures: {
      unit: 'Rs Cr (fundamental fallback)',
      items,
      tables: {},
    },
    business_plans: {
      highlights: [],
      key_points_excerpt: '',
      recent_concalls: [],
    },
    source: 'fundamental_fallback',
    fetched_at: new Date().toISOString(),
  };
}

function hasUsableExpenditureValues(profile: ScreenerProfile | null): boolean {
  const items = profile?.expenditures?.items ?? [];
  return items.some((item) => Number.isFinite(Number(item.latest_cr)) && Number(item.latest_cr) !== 0);
}

function hasCoreFundamentals(metrics: Record<string, unknown>): boolean {
  return (
    Number(metrics.price ?? 0) > 0 &&
    Number(metrics.market_cap_cr ?? 0) > 0 &&
    Number(metrics.eps ?? 0) > 0 &&
    Number(metrics.pe ?? 0) > 0 &&
    Number(metrics.roe ?? 0) > 0 &&
    Number(metrics.roce ?? 0) > 0
  );
}

function dataQuality(metrics: Record<string, unknown>, sources: string[]) {
  const usesFallback = sources.some((source) => source.toLowerCase().includes('sample_fallback'));
  if (usesFallback) {
    return {
      level: 'estimated',
      label: 'Estimated fundamentals',
      message:
        'Live source returned incomplete fundamentals. Price is live when available; valuation ratios, cash-flow and expenditure fields may use fallback estimates. Re-run Full Verify before sizing.',
    };
  }
  if (!hasCoreFundamentals(metrics)) {
    return {
      level: 'limited',
      label: 'Limited fundamentals',
      message:
        'Core valuation inputs are incomplete. Treat intrinsic value, MOS and quality score as provisional until reported fundamentals are refreshed.',
    };
  }
  return {
    level: 'reported',
    label: 'Reported fundamentals',
    message: 'Core valuation inputs are populated from live/cached market and fundamentals sources.',
  };
}

function valuationFromScreenerRow(row: ReturnType<typeof screenSymbol>) {
  const verifyScore = row.verify_score ?? screeningScoreFromQuality(Number(row.composite_score ?? 0));
  return {
    intrinsic: Number(row.intrinsic ?? 0),
    mos: row.mos ?? null,
    zone: row.zone ?? '',
    fair_pe: Number(row.fair_pe ?? 0),
    quality_score: Number(row.composite_score ?? 0),
    composite_score: Number(row.composite_score ?? 0),
    verify_score: verifyScore,
    recommendation: row.recommendation ?? '',
    final_rating: row.recommendation ?? '',
    graham: Number(row.graham ?? 0),
    method: row.method ?? '',
  };
}

export async function getStockSummary(symbol: string, refresh = false) {
  const normalized = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  const metricsResult = await resolveStockMetrics(normalized, refresh);

  const { metrics, sources, from_cache } = metricsResult;

  if ((metrics.price ?? 0) <= 0 && sources.includes('sample_fallback')) {
    throw new Error(`Could not load market data for ${normalized}`);
  }

  const screenerRow = screenSymbol(String(metrics.symbol ?? symbol), metrics);
  const valuation = valuationFromScreenerRow(screenerRow);

  return {
    symbol: String(metrics.symbol ?? normalized),
    name: String(metrics.name ?? metrics.symbol ?? normalized),
    success: true,
    metrics,
    valuation,
    sources,
    from_cache,
    data_quality: dataQuality(metrics as Record<string, unknown>, sources),
    iv_drift: null,
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
  let profile = await fetchScreenerProfile(normalized, 'consolidated', refresh);
  if (profile && !profile.about && !profile.key_points && (profile.expenditures?.items?.length ?? 0) === 0) {
    profile = await fetchScreenerProfile(normalized, 'standalone', refresh);
  }
  if (!hasUsableExpenditureValues(profile)) {
    const { metrics } = await resolveStockMetrics(normalized, refresh);
    const fallback = fallbackProfileFromMetrics(normalized, metrics);
    profile = profile
      ? {
          ...profile,
          expenditures: fallback.expenditures,
          source: `${profile.source || 'screener.in'} + ${fallback.source}`,
        }
      : fallback;
  }
  return { symbol: normalized, profile };
}

export async function refreshStockCaches(symbol: string) {
  const normalized = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  let deleted_keys = 0;
  try {
    deleted_keys = await cacheClearSymbol(normalized);
  } catch {
    deleted_keys = 0;
  }
  const summary = await getStockSummary(normalized, true);
  return { symbol: normalized, deleted_keys, summary };
}
