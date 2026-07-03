import { normalizeSector } from '@sv/core';
import type { StockMetrics } from '@sv/shared';
import { lookupSectorHint } from '@sv/shared';
import type { ScreenerAnnualFinancials } from './screener-annual.js';
import { enrichMetricsFromScreenerAnnual } from './screener-annual.js';

function revenueYoyFromHistory(revs: number[]): number {
  if (revs.length < 2) return 0;
  const latest = revs[revs.length - 1];
  const prev = revs[revs.length - 2];
  if (latest <= 0 || prev <= 0) return 0;
  return Math.round(((latest - prev) / prev) * 1000) / 10;
}

function revenueCagr3y(revs: number[]): number {
  if (revs.length < 4) return 0;
  const first = revs[revs.length - 4];
  const last = revs[revs.length - 1];
  if (first <= 0 || last <= 0) return 0;
  return Math.round((Math.pow(last / first, 1 / 3) - 1) * 1000) / 10;
}

/** Shared enrich for Stock Details, Verify, and Full Verify fetch paths. */
export function enrichStockMetrics(
  metrics: StockMetrics,
  annual: ScreenerAnnualFinancials | null | undefined,
  options: {
    symbol?: string;
    peg?: number;
    div_yield?: number;
  } = {},
): StockMetrics {
  let out = enrichMetricsFromScreenerAnnual(metrics, annual);

  if (annual?.company_name && (!out.name || out.name.toUpperCase() === String(out.symbol ?? '').toUpperCase())) {
    out = { ...out, name: annual.company_name };
  }
  if (annual?.industry) {
    out = { ...out, industry: annual.industry };
    if (!out.sector || out.sector === 'general') {
      out = { ...out, sector: normalizeSector(annual.industry) };
    }
  }
  if (annual?.sector_label && (!out.sector || out.sector === 'general')) {
    out = { ...out, sector: normalizeSector(annual.sector_label) };
  }
  if (annual?.promoter_holding_pct && Number(out.promoter_holding ?? 0) <= 0) {
    out = {
      ...out,
      promoter_holding: annual.promoter_holding_pct,
      promoter_holding_source: 'screener_meta',
    };
  }

  const sym = String(options.symbol ?? out.symbol ?? '').toUpperCase().replace(/\.(NS|BO)$/, '');
  const hint = sym ? lookupSectorHint(sym) : undefined;
  if (hint && (!out.sector || out.sector === 'general')) {
    out = { ...out, sector: hint };
  }

  const price = Number(out.price ?? 0);
  const mcap = Number(out.market_cap_cr ?? 0);
  const equity = annual?.shareholders_equity_cr ?? 0;

  if (Number(out.book_value ?? 0) <= 0 && equity > 0 && price > 0 && mcap > 0) {
    const bv = Math.round(((equity * price) / mcap) * 100) / 100;
    out = { ...out, book_value: bv };
  }

  if (Number(out.pb_ratio ?? 0) <= 0 && Number(out.book_value ?? 0) > 0 && price > 0) {
    out = { ...out, pb_ratio: Math.round((price / Number(out.book_value)) * 100) / 100 };
  }

  if (annual?.revenue_history?.length) {
    const yoy = revenueYoyFromHistory(annual.revenue_history);
    const cagr = revenueCagr3y(annual.revenue_history);
    if (Number(out.sales_yoy ?? 0) <= 0 && yoy !== 0) {
      out = { ...out, sales_yoy: yoy, revenue_growth: yoy };
    }
    if (Number(out.profit_yoy ?? 0) <= 0 && annual.pat_history.length >= 2) {
      const patYoy = revenueYoyFromHistory(annual.pat_history);
      if (patYoy !== 0) {
        out = { ...out, profit_yoy: patYoy, eps_growth: patYoy };
      }
    }
    if (cagr > 0 && Number(out.revenue_growth ?? 0) <= 0) {
      out = { ...out, revenue_growth: out.sales_yoy || cagr };
    }
  }

  if (Number(out.total_debt_cr ?? 0) <= 0 && annual?.total_debt_cr) {
    out = { ...out, total_debt_cr: annual.total_debt_cr };
  }
  if (Number(out.total_cash_cr ?? 0) <= 0 && annual?.total_cash_cr) {
    out = { ...out, total_cash_cr: annual.total_cash_cr };
  }
  if (Number(out.operating_margin ?? 0) <= 0 && annual?.operating_margin_pct) {
    out = { ...out, operating_margin: annual.operating_margin_pct };
  }
  if (Number(out.roa ?? 0) <= 0 && annual?.roa_pct) {
    out = { ...out, roa: annual.roa_pct };
  }
  if (Number(out.debt_to_equity ?? 0) <= 0 && annual?.debt_to_equity) {
    out = { ...out, debt_to_equity: annual.debt_to_equity };
  }

  if (Number(out.capex_cr ?? 0) <= 0 && Number(out.cfo_cr ?? 0) > 0 && Number(out.fcf_cr ?? 0) !== 0) {
    out = {
      ...out,
      capex_cr: Math.round((Number(out.cfo_cr) - Number(out.fcf_cr)) * 100) / 100,
    };
  }

  const peg = options.peg ?? Number(out.peg_ratio ?? 0);
  if (peg > 0) {
    out = { ...out, peg_ratio: peg };
  } else if (
    Number(out.peg_ratio ?? 0) <= 0 &&
    Number(out.pe ?? 0) > 0 &&
    Number(out.eps_growth ?? out.profit_yoy ?? 0) > 0
  ) {
    out = {
      ...out,
      peg_ratio: Math.round((Number(out.pe) / Number(out.eps_growth ?? out.profit_yoy)) * 100) / 100,
    };
  }

  if (options.div_yield && Number(out.div_yield ?? 0) <= 0) {
    out = { ...out, div_yield: options.div_yield };
  }

  return out;
}
