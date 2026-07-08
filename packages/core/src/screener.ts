import type { ScreenerRow, StockMetrics } from '@sv/shared';
import { estimate } from './mos-helper.js';
import { matrixVerdict } from './valuation.js';
import { moatTierRank } from './cfa-valuation-engine.js';
import { PRESET_FILTERS, type ScreenerFilters } from './screener-presets.js';
export { PRESET_FILTERS, PRESET_LABELS, SCREENER_PRESET_KEYS, type ScreenerFilters } from './screener-presets.js';

/** Demo/sample metrics when live fetch unavailable (MVP fallback). */
const SAMPLE_METRICS: Record<string, Partial<StockMetrics>> = {
  TCS: {
    name: 'Tata Consultancy Services',
    price: 3850,
    pe: 28,
    eps: 135,
    book_value: 296,
    pb_ratio: 6.08,
    peg_ratio: 1.2,
    roe: 45,
    roa: 28,
    roce: 45,
    sales_yoy: 9.6,
    profit_yoy: 12.2,
    eps_growth: 12.2,
    revenue_growth: 9.6,
    revenue_growth_3yr: 10,
    sector: 'IT',
    industry: 'IT Services',
    market_cap_cr: 800000,
    debt_to_equity: 0.05,
    div_yield: 1.2,
    fcf_cr: 35000,
    cfo_cr: 42000,
    capex_cr: 7000,
    gross_margin: 38,
    ebitda_margin: 28,
    operating_margin: 26,
    interest_coverage: 100,
    total_debt_cr: 5000,
    total_cash_cr: 45000,
    high_52w: 4500,
    low_52w: 3200,
  },
  INFY: {
    name: 'Infosys',
    price: 1520,
    pe: 24,
    eps: 63,
    book_value: 220,
    pb_ratio: 6.9,
    roe: 28,
    roa: 18,
    roce: 32,
    sales_yoy: 8,
    profit_yoy: 7,
    eps_growth: 7,
    revenue_growth: 8,
    sector: 'IT',
    industry: 'IT Services',
    market_cap_cr: 630000,
    debt_to_equity: 0.02,
    div_yield: 2.1,
    fcf_cr: 22000,
    cfo_cr: 27000,
    capex_cr: 5000,
  },
  RELIANCE: {
    name: 'Reliance Industries',
    price: 1280,
    pe: 26,
    eps: 49,
    book_value: 620,
    pb_ratio: 2.06,
    peg_ratio: 1.5,
    roe: 14,
    roa: 6,
    roce: 11,
    sales_yoy: 15,
    profit_yoy: 12,
    eps_growth: 12,
    revenue_growth: 15,
    sector: 'Oil & Gas',
    industry: 'Oil & Gas',
    market_cap_cr: 1700000,
    debt_to_equity: 0.4,
    div_yield: 0.4,
    fcf_cr: 80000,
    cfo_cr: 120000,
    capex_cr: 40000,
    total_debt_cr: 280000,
    total_cash_cr: 190000,
  },
  HDFCBANK: {
    name: 'HDFC Bank',
    price: 1680,
    pe: 18,
    eps: 93,
    book_value: 620,
    pb_ratio: 2.7,
    roe: 16,
    roa: 1.9,
    roce: 7,
    sales_yoy: 18,
    profit_yoy: 14,
    eps_growth: 14,
    revenue_growth: 18,
    sector: 'Banking',
    market_cap_cr: 1280000,
    debt_to_equity: 0,
  },
  ITC: {
    name: 'ITC',
    price: 420,
    pe: 28,
    eps: 15,
    book_value: 55,
    pb_ratio: 7.6,
    roe: 24,
    roa: 18,
    roce: 30,
    sales_yoy: 6,
    profit_yoy: 8,
    eps_growth: 8,
    revenue_growth: 6,
    sector: 'FMCG',
    market_cap_cr: 525000,
    debt_to_equity: 0.01,
    div_yield: 3.2,
    fcf_cr: 15000,
    cfo_cr: 18000,
    capex_cr: 3000,
  },
};

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.NS$|\.BO$/, '');
}

export function buildStockMetrics(symbol: string, overrides: Partial<StockMetrics> = {}): StockMetrics {
  const sym = normalizeSymbol(symbol);
  const sample = SAMPLE_METRICS[sym] ?? {};
  return {
    name: sym,
    price: 100,
    pe: 20,
    roe: 15,
    roce: 14,
    sales_yoy: 8,
    profit_yoy: 8,
    sector: 'general',
    ...sample,
    ...overrides,
    symbol: sym,
  };
}

export function screenSymbol(symbol: string, metrics?: Partial<StockMetrics>): ScreenerRow {
  const stock = buildStockMetrics(symbol, metrics);
  const analysis = estimate(stock);
  const composite = analysis.quality_score ?? 0;
  const verifyScore = Math.round(Math.max(0, Math.min(56, composite * 56 / 100)));
  const mos = analysis.mos;
  const recommendation = mos === null ? 'Need Data' : matrixVerdict(verifyScore, mos);
  const cfa = analysis.cfa_report as { moat_tier?: string; moat_count?: number } | undefined;

  return {
    symbol: stock.symbol,
    name: String(stock.name ?? stock.symbol),
    price: Number(stock.price ?? 0),
    pe: Number(stock.pe ?? 0),
    roe: Number(stock.roe ?? 0),
    roce: Number(stock.roce ?? 0),
    promoter_holding: Number(stock.promoter_holding ?? 0),
    intrinsic: analysis.intrinsic,
    mos: analysis.mos,
    zone: analysis.zone,
    action: analysis.action,
    fair_pe: analysis.fair_pe,
    method: analysis.method,
    graham: analysis.graham,
    composite_score: composite,
    recommendation,
    passed: mos !== null && verifyScore >= 25 && mos >= -5,
    moat_tier: cfa?.moat_tier ?? '',
    moat_count: Number(cfa?.moat_count ?? 0),
    market_cap_cr: Number(stock.market_cap_cr ?? 0),
    sales_yoy: Number(stock.sales_yoy ?? 0),
    div_yield: Number(stock.div_yield ?? 0),
  };
}

/** Cheap ratio gates before full Yahoo + CFA fetch (PHP passesTableGates parity). */
export interface TableGateInput {
  roce?: number;
  roe?: number;
  pe?: number;
  sales_yoy?: number;
  market_cap_cr?: number;
  div_yield?: number;
}

export function passesTableGates(stock: TableGateInput, filters: ScreenerFilters = {}): boolean {
  const roce = stock.roce ?? 0;
  const roe = stock.roe ?? 0;
  const pe = stock.pe ?? 0;
  const salesYoy = stock.sales_yoy ?? 0;
  const mcap = stock.market_cap_cr ?? 0;
  const div = stock.div_yield ?? 0;

  if (filters.min_roce !== undefined && roce < filters.min_roce) return false;
  if (filters.min_roe !== undefined && filters.min_roe > 0 && roe < filters.min_roe) return false;
  if (filters.max_pe !== undefined && (pe <= 0 || pe > filters.max_pe)) return false;
  if (filters.min_sales_yoy !== undefined && salesYoy < filters.min_sales_yoy) return false;
  if (filters.min_mcap_cr !== undefined && filters.min_mcap_cr > 0 && mcap < filters.min_mcap_cr) return false;
  if (filters.min_div_yield !== undefined && filters.min_div_yield > 0 && div < filters.min_div_yield) {
    return false;
  }
  return true;
}

export function passesFilters(row: ScreenerRow, filters: ScreenerFilters = {}): boolean {
  if (filters.min_roe !== undefined && row.roe < filters.min_roe) return false;
  if (filters.min_roce !== undefined && row.roce < filters.min_roce) return false;
  if (filters.min_mos !== undefined && (row.mos === null || row.mos < filters.min_mos)) return false;
  if (filters.max_pe !== undefined && row.pe > filters.max_pe) return false;
  if (filters.min_promoter_holding !== undefined && filters.min_promoter_holding > 0) {
    const prom = Number(row.promoter_holding ?? 0);
    if (prom <= 0 || prom < filters.min_promoter_holding) return false;
  }
  if (filters.min_score !== undefined && row.composite_score < filters.min_score) return false;
  if (filters.min_sales_yoy !== undefined && (row.sales_yoy ?? 0) < filters.min_sales_yoy) return false;
  if (filters.min_mcap_cr !== undefined && filters.min_mcap_cr > 0 && (row.market_cap_cr ?? 0) < filters.min_mcap_cr) {
    return false;
  }
  if (filters.min_div_yield !== undefined && filters.min_div_yield > 0 && (row.div_yield ?? 0) < filters.min_div_yield) {
    return false;
  }
  if (filters.min_moat_tier) {
    const rowTier = String(row.moat_tier ?? '');
    if (moatTierRank(rowTier) < moatTierRank(filters.min_moat_tier)) return false;
  }
  if (filters.min_moat_count !== undefined && filters.min_moat_count > 0 && (row.moat_count ?? 0) < filters.min_moat_count) {
    return false;
  }
  return true;
}

export function runScreener(
  symbols: string[],
  preset?: string,
  customFilters: ScreenerFilters = {},
): ScreenerRow[] {
  const filters = { ...(preset ? PRESET_FILTERS[preset] ?? {} : {}), ...customFilters };
  const rows: ScreenerRow[] = [];

  for (const sym of symbols) {
    const row = screenSymbol(sym);
    if (passesFilters(row, filters)) {
      rows.push(row);
    }
  }

  return rows.sort((a, b) => (b.mos ?? -999) - (a.mos ?? -999));
}
