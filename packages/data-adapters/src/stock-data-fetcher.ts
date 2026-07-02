import type { StockMetrics } from '@sv/shared';
import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, getCacheTtl } from '@sv/shared';
import { fetchScreenerRatios } from './screener-in.js';
import { fetchYahooFundamentals } from './yahoo.js';
import { normalizeDebtToEquity } from './http.js';

export interface FetchResult {
  success: boolean;
  symbol: string;
  company_name?: string;
  sources: string[];
  metrics?: StockMetrics;
  from_cache?: boolean;
  error?: string;
}

function normalizeBaseSymbol(query: string): string {
  return query.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
}

export function mergeMetrics(
  baseSymbol: string,
  yahoo: Awaited<ReturnType<typeof fetchYahooFundamentals>>,
  screener: Awaited<ReturnType<typeof fetchScreenerRatios>>,
): StockMetrics {
  const price = yahoo?.price ?? 0;
  const eps = yahoo?.eps ?? 0;
  const bookValue = yahoo?.book_value ?? 0;
  let pe = yahoo?.pe ?? 0;
  if (pe <= 0 && screener?.pe) pe = screener.pe;
  if (pe <= 0 && eps > 0 && price > 0) pe = Math.round((price / eps) * 100) / 100;

  let roe = yahoo?.roe ?? 0;
  if (roe <= 0 && screener?.roe) roe = screener.roe;

  let roce = screener?.roce ?? 0;
  if (roce <= 0 && roe > 0) roce = Math.round(roe * 0.85 * 10) / 10;

  let de = normalizeDebtToEquity(yahoo?.debt_to_equity ?? 0);
  if (de <= 0 && screener?.debt_to_equity) de = screener.debt_to_equity;

  const salesYoy = screener?.sales_yoy ?? yahoo?.revenue_growth ?? 0;
  const profitYoy = screener?.profit_yoy ?? yahoo?.eps_growth ?? 0;
  const capexCr =
    (yahoo?.cfo_cr ?? 0) > 0 && (yahoo?.fcf_cr ?? 0) !== 0
      ? Math.round(((yahoo?.cfo_cr ?? 0) - (yahoo?.fcf_cr ?? 0)) * 100) / 100
      : 0;

  return {
    symbol: baseSymbol,
    name: yahoo?.company_name ?? baseSymbol,
    price,
    pe,
    eps,
    book_value: bookValue,
    pb_ratio: yahoo?.pb_ratio ?? (bookValue > 0 && price > 0 ? Math.round((price / bookValue) * 100) / 100 : 0),
    peg_ratio: yahoo?.peg_ratio ?? 0,
    roe,
    roa: yahoo?.roa ?? 0,
    roce,
    sales_yoy: salesYoy,
    profit_yoy: profitYoy,
    eps_growth: profitYoy,
    revenue_growth: salesYoy,
    sector: yahoo?.sector ?? 'general',
    industry: yahoo?.industry ?? '',
    market_cap_cr: screener?.market_cap_cr ?? yahoo?.market_cap_cr ?? 0,
    debt_to_equity: de,
    div_yield: yahoo?.div_yield ?? 0,
    fcf_cr: yahoo?.fcf_cr ?? 0,
    cfo_cr: yahoo?.cfo_cr ?? 0,
    capex_cr: capexCr,
    high_52w: yahoo?.high_52w ?? 0,
    low_52w: yahoo?.low_52w ?? 0,
    gross_margin: yahoo?.gross_margin ?? 0,
    ebitda_margin: yahoo?.ebitda_margin ?? 0,
    operating_margin: yahoo?.operating_margin ?? 0,
    interest_coverage: yahoo?.interest_coverage ?? 0,
    total_debt_cr: yahoo?.total_debt_cr ?? 0,
    total_cash_cr: yahoo?.total_cash_cr ?? 0,
  };
}

export async function fetchStockData(
  query: string,
  options: { refresh?: boolean } = {},
): Promise<FetchResult> {
  const baseSymbol = normalizeBaseSymbol(query);
  if (!baseSymbol) {
    return { success: false, symbol: '', sources: [], error: 'Empty symbol' };
  }

  const stockKey = cacheKey(CACHE_PREFIX.STOCK, baseSymbol);

  if (!options.refresh) {
    const cached = await cacheGetJson<FetchResult>(stockKey);
    if (cached?.success && cached.metrics) {
      return { ...cached, from_cache: true };
    }
  }

  const sources: string[] = [];
  const [yahoo, screener] = await Promise.all([
    fetchYahooFundamentals(baseSymbol),
    fetchScreenerRatios(baseSymbol, options.refresh ?? false),
  ]);
  if (yahoo) sources.push(`Yahoo Finance (${yahoo.symbol})`);
  if (screener) sources.push(`Screener.in (${baseSymbol})`);

  if (!yahoo && !screener) {
    return {
      success: false,
      symbol: baseSymbol,
      sources: [],
      error: `Could not fetch data for ${baseSymbol}. Try again later.`,
    };
  }

  const metrics = mergeMetrics(baseSymbol, yahoo, screener);
  if ((metrics.price ?? 0) <= 0) {
    return {
      success: false,
      symbol: baseSymbol,
      sources,
      error: `No price data for ${baseSymbol}`,
    };
  }

  const result: FetchResult = {
    success: true,
    symbol: baseSymbol,
    company_name: String(metrics.name ?? baseSymbol),
    sources,
    metrics,
    from_cache: false,
  };

  await cacheSetJson(stockKey, result, getCacheTtl().stock).catch(() => undefined);
  return result;
}
