import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, CACHE_TTL } from '@sv/shared';
import { httpGet, pct, raw, toCrores } from './http.js';

type YahooModule = Record<string, unknown>;

export interface YahooFundamentals {
  symbol: string;
  company_name: string;
  sector: string;
  industry: string;
  price: number;
  eps: number;
  book_value: number;
  pe: number;
  pb_ratio: number;
  peg_ratio: number;
  roe: number;
  roa: number;
  market_cap_cr: number;
  div_yield: number;
  debt_to_equity: number;
  revenue_growth: number;
  eps_growth: number;
  fcf_cr: number;
  cfo_cr: number;
  high_52w: number;
  low_52w: number;
  gross_margin: number;
  ebitda_margin: number;
  operating_margin: number;
  interest_coverage: number;
  total_debt_cr: number;
  total_cash_cr: number;
}

function yahooSymbols(base: string): string[] {
  const sym = base.toUpperCase().replace(/\.(NS|BO)$/, '');
  return [`${sym}.NS`, `${sym}.BO`];
}

async function fetchQuoteSummary(yahooSymbol: string): Promise<Record<string, YahooModule> | null> {
  const cacheKeyStr = cacheKey(CACHE_PREFIX.YAHOO, yahooSymbol);
  const cached = await cacheGetJson<Record<string, YahooModule>>(cacheKeyStr);
  if (cached) return cached;

  const modules = [
    'summaryProfile',
    'summaryDetail',
    'financialData',
    'defaultKeyStatistics',
  ].join(',');

  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}?modules=${modules}`;
  const body = await httpGet(url);
  if (!body) return null;

  try {
    const json = JSON.parse(body) as {
      quoteSummary?: { result?: Array<Record<string, YahooModule>> };
    };
    const result = json.quoteSummary?.result?.[0];
    if (!result) return null;
    await cacheSetJson(cacheKeyStr, result, CACHE_TTL.yahoo);
    return result;
  } catch {
    return null;
  }
}

function mapSector(sector: string, industry: string): string {
  const s = `${sector} ${industry}`.toLowerCase();
  if (s.includes('bank')) return 'Banking';
  if (s.includes('software') || s.includes('it ')) return 'IT';
  if (s.includes('pharma') || s.includes('health')) return 'Pharma';
  if (s.includes('fmcg') || s.includes('consumer')) return 'FMCG';
  if (s.includes('auto')) return 'Auto';
  if (s.includes('oil') || s.includes('gas')) return 'Oil & Gas';
  return sector || industry || 'general';
}

export function parseYahooQuote(
  yahooSymbol: string,
  data: Record<string, YahooModule>,
): YahooFundamentals {
  const fd = (data.financialData ?? {}) as Record<string, unknown>;
  const ks = (data.defaultKeyStatistics ?? {}) as Record<string, unknown>;
  const sd = (data.summaryDetail ?? {}) as Record<string, unknown>;
  const sp = (data.summaryProfile ?? {}) as Record<string, unknown>;

  const price = raw(fd, 'currentPrice') || raw(sd, 'regularMarketPrice');
  const eps = raw(ks, 'trailingEps');
  const bookValue = raw(ks, 'bookValue');
  const pe = raw(sd, 'trailingPE') || (eps > 0 && price > 0 ? price / eps : 0);
  const pb = raw(ks, 'priceToBook') || (bookValue > 0 && price > 0 ? price / bookValue : 0);
  const peg = raw(ks, 'pegRatio');
  const high52 = raw(sd, 'fiftyTwoWeekHigh') || raw(ks, 'fiftyTwoWeekHigh');
  const low52 = raw(sd, 'fiftyTwoWeekLow') || raw(ks, 'fiftyTwoWeekLow');

  return {
    symbol: yahooSymbol,
    company_name: String(sp.longName ?? sp.shortName ?? yahooSymbol),
    sector: mapSector(String(sp.sector ?? ''), String(sp.industry ?? '')),
    industry: String(sp.industry ?? ''),
    price: Math.round(price * 100) / 100,
    eps: Math.round(eps * 100) / 100,
    book_value: Math.round(bookValue * 100) / 100,
    pe: Math.round(pe * 100) / 100,
    pb_ratio: Math.round(pb * 100) / 100,
    peg_ratio: Math.round(peg * 100) / 100,
    roe: pct(raw(fd, 'returnOnEquity')),
    roa: pct(raw(fd, 'returnOnAssets')),
    market_cap_cr: toCrores(raw(sd, 'marketCap')),
    div_yield: pct(raw(sd, 'dividendYield')),
    debt_to_equity: raw(fd, 'debtToEquity'),
    revenue_growth: pct(raw(fd, 'revenueGrowth')),
    eps_growth: pct(raw(fd, 'earningsGrowth') || raw(ks, 'earningsQuarterlyGrowth')),
    fcf_cr: toCrores(raw(fd, 'freeCashflow')),
    cfo_cr: toCrores(raw(fd, 'operatingCashflow')),
    high_52w: Math.round(high52 * 100) / 100,
    low_52w: Math.round(low52 * 100) / 100,
    gross_margin: pct(raw(fd, 'grossMargins')),
    ebitda_margin: pct(raw(fd, 'ebitdaMargins')),
    operating_margin: pct(raw(fd, 'operatingMargins')),
    interest_coverage: Math.round(raw(fd, 'interestCoverage') * 100) / 100,
    total_debt_cr: toCrores(raw(fd, 'totalDebt')),
    total_cash_cr: toCrores(raw(fd, 'totalCash')),
  };
}

export async function fetchYahooChartPrice(baseSymbol: string): Promise<{ price: number; symbol: string } | null> {
  for (const yahooSymbol of yahooSymbols(baseSymbol)) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d`;
    const body = await httpGet(url);
    if (!body) continue;
    try {
      const json = JSON.parse(body) as {
        chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
      };
      const price = json.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0;
      if (price > 0) return { price, symbol: yahooSymbol };
    } catch {
      continue;
    }
  }
  return null;
}

export async function fetchYahooFundamentals(baseSymbol: string): Promise<YahooFundamentals | null> {
  let chartFallback: { price: number; symbol: string } | null = null;

  for (const yahooSymbol of yahooSymbols(baseSymbol)) {
    const data = await fetchQuoteSummary(yahooSymbol);
    if (data) {
      const parsed = parseYahooQuote(yahooSymbol, data);
      if (parsed.price > 0) return parsed;
    }
    if (!chartFallback) {
      chartFallback = await fetchYahooChartPrice(baseSymbol);
    }
  }

  if (chartFallback) {
    return {
      symbol: chartFallback.symbol,
      company_name: baseSymbol,
      sector: 'general',
      industry: '',
      price: chartFallback.price,
      eps: 0,
      book_value: 0,
      pe: 0,
      pb_ratio: 0,
      peg_ratio: 0,
      roe: 0,
      roa: 0,
      market_cap_cr: 0,
      div_yield: 0,
      debt_to_equity: 0,
      revenue_growth: 0,
      eps_growth: 0,
      fcf_cr: 0,
      cfo_cr: 0,
      high_52w: 0,
      low_52w: 0,
      gross_margin: 0,
      ebitda_margin: 0,
      operating_margin: 0,
      interest_coverage: 0,
      total_debt_cr: 0,
      total_cash_cr: 0,
    };
  }

  return null;
}
