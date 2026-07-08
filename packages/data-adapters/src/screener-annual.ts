import type { StockMetrics } from '@sv/shared';
import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, CACHE_TTL } from '@sv/shared';
import { httpGet } from './http.js';
import { parseSectionTable } from './screener-financials.js';

export interface ScreenerAnnualFinancials {
  revenue_history: number[];
  pat_history: number[];
  shareholders_equity_cr: number;
  summary: string;
  company_name?: string;
  sector_label?: string;
  industry?: string;
  promoter_holding_pct?: number;
  market_cap_cr?: number;
  revenue_cr?: number;
  eps_consolidated?: number;
  operating_profit_latest?: number;
  ebitda_margin_pct?: number;
  roe_pct?: number;
  roce_pct?: number;
  cfo_cr?: number;
  fcf_cr?: number;
  capex_cr?: number;
  total_debt_cr?: number;
  total_cash_cr?: number;
  operating_margin_pct?: number;
  roa_pct?: number;
  debt_to_equity?: number;
}

function rowValues(rows: Record<string, Record<string, number | null>>, labels: string[]): number[] {
  for (const label of labels) {
    const series = rows[label];
    if (!series) continue;
    const vals = Object.values(series).filter((v): v is number => v !== null && v > 0);
    if (vals.length >= 2) return vals;
  }
  return [];
}

function latestRowValue(
  rows: Record<string, Record<string, number | null>>,
  labels: string[],
): number {
  for (const label of labels) {
    const series = rows[label];
    if (!series) continue;
    const vals = Object.values(series).filter((v): v is number => v !== null);
    if (vals.length) return vals[vals.length - 1];
  }
  return 0;
}

function latestEquityCr(rows: Record<string, Record<string, number | null>>): number {
  for (const label of ["Shareholders' Funds", 'Total Equity', "Shareholder's Funds"]) {
    const v = latestRowValue(rows, [label]);
    if (v > 0) return v;
  }
  const reserves = latestRowValue(rows, ['Reserves']);
  const equityCapital = latestRowValue(rows, ['Equity Capital']);
  if (reserves > 0 && equityCapital > 0) {
    return Math.round((reserves + equityCapital) * 100) / 100;
  }
  if (reserves > 0) return reserves;
  return equityCapital;
}

function latestCashCr(rows: Record<string, Record<string, number | null>>): number {
  const cash = latestRowValue(rows, [
    'Cash Equivalents',
    'Cash +',
    'Cash and Cash Equivalents',
    'Cash and Bank Balances',
  ]);
  const investments = latestRowValue(rows, ['Investments', 'Current Investments']);
  if (cash > 0 && investments > 0) {
    return Math.round((cash + investments) * 100) / 100;
  }
  if (cash > 0) return cash;
  return investments;
}

function parseLinkedLabel(html: string, title: string): string {
  const re = new RegExp(`title="${title}"[^>]*>\\s*([^<]+?)\\s*</a>`, 'i');
  const match = html.match(re);
  return match ? match[1].replace(/&amp;/g, '&').trim() : '';
}

function parsePromoterHoldingPct(html: string): number {
  const desc = html.match(/<meta name="description" content="([^"]+)"/i);
  if (!desc) return 0;
  const prom = desc[1].match(/Promoter Holding:\s*([0-9.]+)\s*%/i);
  if (!prom) return 0;
  const n = parseFloat(prom[1]);
  return Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n * 100) / 100 : 0;
}

function parseDescriptionNumber(html: string, label: string): number {
  const desc = html.match(/<meta name="description" content="([^"]+)"/i);
  if (!desc) return 0;
  const re = new RegExp(`${label}:\\s*([0-9,.]+)`, 'i');
  const match = desc[1].match(re);
  if (!match) return 0;
  const n = parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

export function parseScreenerAnnualFinancials(html: string): ScreenerAnnualFinancials {
  const pl = parseSectionTable(html, 'profit-loss');
  const bs = parseSectionTable(html, 'balance-sheet');
  const cf = parseSectionTable(html, 'cash-flow');

  const revenue = rowValues(pl.rows, ['Sales', 'Sales+', 'Revenue', 'Total Revenue']);
  const pat = rowValues(pl.rows, ['Net Profit', 'Profit after tax', 'PAT']);
  const epsConsolidated = latestRowValue(pl.rows, ['EPS in Rs', 'EPS']);
  const operatingProfit = latestRowValue(pl.rows, ['Operating Profit', 'EBITDA']);
  const revLatest = revenue.length ? revenue[revenue.length - 1] : 0;
  const opmPct = latestRowValue(pl.rows, ['OPM %', 'Operating Margin %']);
  const ebitdaMargin =
    opmPct > 0
      ? opmPct
      : revLatest > 0 && operatingProfit > 0
        ? Math.round((operatingProfit / revLatest) * 10000) / 100
        : 0;
  const patLatest = pat.length ? pat[pat.length - 1] : latestRowValue(pl.rows, ['Net Profit', 'Profit after tax', 'PAT']);
  const totalAssets = latestRowValue(bs.rows, ['Total Assets', 'Total assets']);

  const cfo = latestRowValue(cf.rows, [
    'Cash from Operating Activity +',
    'Cash from Operating Activity',
  ]);
  const fcf = latestRowValue(cf.rows, ['Free Cash Flow +', 'Free Cash Flow']);
  const capex = cfo > 0 && fcf >= 0 ? Math.round((cfo - fcf) * 100) / 100 : 0;
  const borrowings = latestRowValue(bs.rows, ['Borrowings', 'Total Debt']);
  const totalCash = latestCashCr(bs.rows);
  const promoterHoldingPct = parsePromoterHoldingPct(html);
  const marketCapCr = parseDescriptionNumber(html, 'Mkt Cap');

  let summary = '';
  const desc = html.match(/<meta name="description" content="([^"]+)"/i);
  if (desc) summary = desc[1].replace(/&amp;/g, '&').slice(0, 500);

  let company_name = '';
  const nameMatch = html.match(/<span class="name">\s*([^<]+?)\s*<\/span>/i);
  if (nameMatch) company_name = nameMatch[1].trim();

  const sectorLabel = parseLinkedLabel(html, 'Sector');
  let industry = parseLinkedLabel(html, 'Industry');
  if (!industry) {
    industry = parseLinkedLabel(html, 'Broad Industry');
  }
  if (!industry) {
    const legacy = html.match(/<a[^>]*class="industry"[^>]*>\s*([^<]+?)\s*<\/a>/i);
    if (legacy) industry = legacy[1].trim();
  }

  const equity = latestEquityCr(bs.rows);
  const roaPct =
    patLatest > 0 && totalAssets > 0
      ? Math.round((patLatest / totalAssets) * 10000) / 100
      : 0;
  const debtToEquity =
    borrowings > 0 && equity > 0 ? Math.round((borrowings / equity) * 10000) / 10000 : 0;
  const roePct = patLatest > 0 && equity > 0 ? Math.round((patLatest / equity) * 10000) / 100 : 0;
  const capitalEmployed = Math.max(equity + borrowings - totalCash, 0);
  const rocePct =
    operatingProfit > 0 && capitalEmployed > 0
      ? Math.round((operatingProfit / capitalEmployed) * 10000) / 100
      : 0;

  return {
    revenue_history: revenue,
    pat_history: pat,
    shareholders_equity_cr: equity,
    summary,
    company_name: company_name || undefined,
    sector_label: sectorLabel || undefined,
    industry: industry || undefined,
    promoter_holding_pct: promoterHoldingPct > 0 ? promoterHoldingPct : undefined,
    market_cap_cr: marketCapCr > 0 ? marketCapCr : undefined,
    revenue_cr: revLatest > 0 ? revLatest : undefined,
    eps_consolidated: epsConsolidated > 0 ? epsConsolidated : undefined,
    operating_profit_latest: operatingProfit > 0 ? operatingProfit : undefined,
    ebitda_margin_pct: ebitdaMargin > 0 ? ebitdaMargin : undefined,
    roe_pct: roePct > 0 ? roePct : undefined,
    roce_pct: rocePct > 0 ? rocePct : undefined,
    cfo_cr: cfo > 0 ? cfo : undefined,
    fcf_cr: fcf > 0 ? fcf : undefined,
    capex_cr: capex > 0 ? capex : undefined,
    total_debt_cr: borrowings > 0 ? borrowings : undefined,
    total_cash_cr: totalCash > 0 ? totalCash : undefined,
    operating_margin_pct: ebitdaMargin > 0 ? ebitdaMargin : undefined,
    roa_pct: roaPct > 0 ? roaPct : undefined,
    debt_to_equity: debtToEquity > 0 ? debtToEquity : undefined,
  };
}

/** Back-fill Phase 2 / 4 metrics when Yahoo quoteSummary is blocked. */
export function enrichMetricsFromScreenerAnnual(
  metrics: StockMetrics,
  annual: ScreenerAnnualFinancials | null | undefined,
): StockMetrics {
  if (!annual) return metrics;
  const out: StockMetrics = { ...metrics };
  const price = Number(out.price ?? 0);
  const mcap = Number(out.market_cap_cr ?? annual.market_cap_cr ?? 0);
  const pe = Number(out.pe ?? 0);

  if (Number(out.market_cap_cr ?? 0) <= 0 && annual.market_cap_cr) {
    out.market_cap_cr = annual.market_cap_cr;
  }
  if (Number(out.revenue_cr ?? 0) <= 0 && annual.revenue_cr) {
    out.revenue_cr = annual.revenue_cr;
  }

  if (annual.eps_consolidated) {
    out.eps = annual.eps_consolidated;
  } else if (Number(out.eps ?? 0) <= 0 && pe > 0 && price > 0) {
    out.eps = Math.round((price / pe) * 100) / 100;
  } else if (Number(out.eps ?? 0) <= 0 && annual.pat_history.length && mcap > 0 && price > 0) {
    const pat = annual.pat_history[annual.pat_history.length - 1] ?? 0;
    if (pat > 0) out.eps = Math.round((pat * price) / mcap * 100) / 100;
  }

  const eps = Number(out.eps ?? 0);
  if (Number(out.pe ?? 0) <= 0 && price > 0 && eps > 0) {
    out.pe = Math.round((price / eps) * 100) / 100;
  }

  if (Number(out.roe ?? 0) <= 0 && annual.roe_pct) {
    out.roe = annual.roe_pct;
  }
  if (Number(out.roce ?? 0) <= 0 && annual.roce_pct) {
    out.roce = annual.roce_pct;
  }

  if (annual.ebitda_margin_pct) {
    out.ebitda_margin = annual.ebitda_margin_pct;
  }
  if (annual.cfo_cr) out.cfo_cr = annual.cfo_cr;
  if (annual.fcf_cr) out.fcf_cr = annual.fcf_cr;
  if (annual.capex_cr) out.capex_cr = annual.capex_cr;
  if (annual.total_debt_cr) {
    out.total_debt_cr = annual.total_debt_cr;
  }
  if (annual.total_cash_cr) {
    out.total_cash_cr = annual.total_cash_cr;
  }
  if (annual.operating_margin_pct) {
    out.operating_margin = annual.operating_margin_pct;
  }
  if (annual.roa_pct) {
    out.roa = annual.roa_pct;
  }
  if (annual.debt_to_equity) {
    out.debt_to_equity = annual.debt_to_equity;
  }

  return out;
}

export async function fetchScreenerAnnualFinancials(
  symbol: string,
  refresh = false,
): Promise<ScreenerAnnualFinancials | null> {
  const slug = symbol.toLowerCase().replace(/\.(ns|bo)$/, '');
  const cacheKeyStr = cacheKey(CACHE_PREFIX.SCREENER_TABLE, `annual:${slug}`);
  if (!refresh) {
    const cached = await cacheGetJson<ScreenerAnnualFinancials>(cacheKeyStr);
    if (cached?.revenue_history) return cached;
  }

  const url = `https://www.screener.in/company/${encodeURIComponent(slug)}/consolidated/`;
  const html = await httpGet(url);
  if (!html) return null;

  const parsed = parseScreenerAnnualFinancials(html);
  await cacheSetJson(cacheKeyStr, parsed, CACHE_TTL.screener_table);
  return parsed;
}
