import {
  estimate,
  normalizeSectorKey,
  revenueGrowth3yr,
  resolveGrowthContext,
  altmanSkip,
  resolveAltmanMeta,
} from '@sv/core';
import type { VerifyFullInput } from '@sv/core';
import type { StockMetrics } from '@sv/shared';

export interface VerifierFetchBlob {
  company_name: string;
  symbol: string;
  sector: string;
  industry: string;
  summary: string;
  current_price: number;
  market_cap_cr: number;
  eps: number;
  eps_consolidated: number;
  eps_standalone: number;
  book_value: number;
  book_value_consolidated: number;
  book_value_standalone: number;
  pe_ratio: number;
  pb_ratio: number;
  peg: number;
  roe: number;
  roce: number;
  roa: number;
  debt_to_equity: number;
  revenue_growth: number;
  revenue_growth_3yr: number;
  eps_growth: number;
  dividend_yield: number;
  fcf_cr: number;
  cfo_cr: number;
  capex_cr: number;
  pat_cr: number;
  total_debt_cr: number;
  shareholders_equity_cr: number;
  promoter_pledge: number;
  promoter_pledge_as_of: string;
  interest_coverage: number;
  ebitda_margin: number;
  gross_margin: number;
  revenue_history: number[];
  '52w_high': number;
  '52w_low': number;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function reviewDateDefault(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function mapToFormSector(sectorKey: string): string {
  const allowed = new Set([
    'banking',
    'it',
    'defence',
    'infra',
    'fmcg',
    'pharma',
    'auto',
    'metal',
    'cement',
    'telecom',
    'utility',
    'reit',
    'general',
  ]);
  if (allowed.has(sectorKey)) return sectorKey;
  if (sectorKey === 'nbfc') return 'banking';
  return 'general';
}

function estimatePiotroski(m: VerifierFetchBlob): number {
  let score = 0;
  if (m.pat_cr > 0) score++;
  if (m.cfo_cr > 0) score++;
  if (m.roa > 0) score++;
  if (m.cfo_cr > m.pat_cr) score++;
  if (m.debt_to_equity <= 0.5) score++;
  if (m.fcf_cr > 0) score++;
  if (m.revenue_growth > 0) score++;
  if (m.gross_margin >= 20) score++;
  if (m.eps_growth > 0) score++;
  return Math.min(9, score);
}

function estimateAltmanBundle(m: VerifierFetchBlob): {
  wc: number;
  retained: number;
  ebit: number;
  totalAssets: number;
  totalLiabilities: number;
  sales: number;
  z: number;
} {
  const totalAssets = Math.max(m.shareholders_equity_cr + m.total_debt_cr, 1);
  const wc = m.fcf_cr * 0.1;
  const retained = m.shareholders_equity_cr * 0.6;
  const ebit = m.pat_cr * 1.2;
  const totalLiabilities = Math.max(m.total_debt_cr, 0.01);
  const revs = m.revenue_history;
  const sales = revs[revs.length - 1] ?? 0;
  const a = wc / totalAssets;
  const b = retained / totalAssets;
  const c = ebit / totalAssets;
  const d = m.market_cap_cr / totalLiabilities;
  const e = sales / totalAssets;
  const z = Math.round((1.2 * a + 1.4 * b + 3.3 * c + 0.6 * d + 1.0 * e) * 100) / 100;
  return { wc, retained, ebit, totalAssets, totalLiabilities, sales, z };
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export function mapToVerifierInput(m: VerifierFetchBlob): VerifyFullInput {
  const revs = [...m.revenue_history];
  const revCount = revs.length;
  const growing = revCount >= 2 && (revs[revCount - 1] ?? 0) > (revs[0] ?? 0);
  const revCagr = revenueGrowth3yr(revs);
  const marginsExpanding = m.ebitda_margin > 0;
  const de = m.debt_to_equity;
  const roe = m.roe;
  const roce = m.roce;
  const peg = m.peg;
  const pe = m.pe_ratio;
  const eps = m.eps;
  const price = m.current_price;
  const fcf = m.fcf_cr;
  const cfo = m.cfo_cr;
  const pat = m.pat_cr;
  const divYield = m.dividend_yield;
  const sectorKey = normalizeSectorKey(m.sector);
  const sector = mapToFormSector(sectorKey);

  const growth = resolveGrowthContext({
    eps_growth: m.eps_growth,
    profit_yoy: m.eps_growth,
    sales_yoy: m.revenue_growth,
    revenue_growth: m.revenue_growth,
    revenue_growth_3yr: revCagr > 0 ? revCagr : m.revenue_growth,
  });

  const mosCalc = estimate({
    symbol: m.symbol,
    name: m.company_name,
    price,
    current_price: price,
    eps,
    book_value: m.book_value,
    pe,
    pe_ratio: pe,
    roe,
    roce,
    sector: m.sector,
    revenue_growth: growth.revenue_growth,
    eps_growth: growth.eps_growth,
    profit_yoy: growth.eps_growth,
    sales_yoy: m.revenue_growth,
    market_cap_cr: m.market_cap_cr,
    debt_to_equity: de,
    div_yield: divYield,
    fcf_cr: fcf,
    cfo_cr: cfo,
    pat_cr: pat,
    revenue_history: revs,
  });

  const intrinsicPe = Math.round(Number(mosCalc.fair_pe ?? 0) * eps * 100) / 100;
  const dcfIv = Number(mosCalc.intrinsic ?? 0);
  const mos = mosCalc.mos ?? 0;

  const fScore = estimatePiotroski(m);
  const altmanSkipFlag = altmanSkip(sectorKey);
  const altmanBundle = altmanSkipFlag ? null : estimateAltmanBundle(m);
  const altmanMeta = resolveAltmanMeta(sectorKey, {
    altman_z: altmanBundle?.z ?? 0,
    altman_skip: altmanSkipFlag,
    z_score_source: altmanSkipFlag ? 'skipped' : altmanBundle && altmanBundle.z > 0 ? 'estimated' : 'missing',
  });
  const zSource = altmanMeta.z_score_source;

  const vtDeclining = !growing && revCount >= 3;
  const vtDivFcf = divYield > 2 && fcf <= 0;
  const vtDebtMargin = de > 0.8 && !marginsExpanding;
  const isGrowth = m.revenue_growth >= 15 || revCagr >= 15;

  const input: VerifyFullInput = {
    fetch_symbol: m.symbol.split('.')[0]?.toUpperCase() ?? m.symbol,
    stock_name: m.company_name,
    sector,
    current_price: price,
    market_cap_cr: m.market_cap_cr,
    analysis_date: todayIso(),
    review_date: reviewDateDefault(),

    p1_industry_outlook: m.revenue_growth > 5 ? 'growing' : m.revenue_growth >= -2 ? 'stable' : 'declining',
    p1_promoter_pledge: m.promoter_pledge,
    pledge_data_as_of: m.promoter_pledge_as_of,
    p1_promoter_stable: 'yes',
    p1_auditor_clean: 'yes',
    p1_capital_allocation: roe >= 15 ? 'yes' : '',
    p1_rpt_normal: 'yes',

    eps_mode: 'consolidated',
    eps_consolidated: m.eps_consolidated || eps,
    eps_standalone: m.eps_standalone || 0,
    book_value_consolidated: m.book_value_consolidated || m.book_value,
    book_value_standalone: m.book_value_standalone || 0,
    revenue_y4: revs[0] ?? '',
    revenue_y3: revs[1] ?? '',
    revenue_y2: revs[2] ?? '',
    revenue_y1: revs[3] ?? '',
    revenue_latest: revs[revCount - 1] ?? '',
    pat_latest: pat,
    eps,
    ebitda_margin_latest: m.ebitda_margin,
    ebitda_margin_prev: Math.max(0, m.ebitda_margin - 1),
    total_debt: m.total_debt_cr,
    shareholders_equity: m.shareholders_equity_cr,
    book_value_latest: m.book_value,
    book_value_prev: m.book_value * 0.92,
    receivable_days_trend: 'stable',
    inventory_days_trend: 'stable',
    cfo,
    capex: m.capex_cr,
    fcf,
    dividend_paid_cr:
      pat > 0 && divYield > 0
        ? Math.round((pat * (divYield / 100) * (m.market_cap_cr / Math.max(price, 1))) / Math.max(eps, 1))
        : 0,
    p2_revenue_growing: growing ? 'yes' : 'no',
    p2_pat_quality: pat > 0 ? 'yes' : 'no',
    p2_margins_ok: marginsExpanding ? 'yes' : '',
    p2_de_ok:
      de <= 0.5 || sectorKey === 'banking' || (sectorKey === 'nbfc' && de < 4) ? 'yes' : 'no',
    p2_bv_growing: 'yes',
    p2_wc_ok: 'yes',
    p2_fcf_positive: fcf > 0 ? 'yes' : 'no',
    p2_cfo_pat: cfo > 0 && pat > 0 && cfo >= pat * 0.7 ? 'yes' : 'no',
    p2_fcf_dividend: (fcf > 0 && divYield <= 0) || fcf > 0 ? 'yes' : 'no',
    p2_chairman_honest: '1',
    p2_auditor_clean: '1',
    p2_contingent_ok: '1',
    p2_accounting_ok: '1',

    roe,
    roce,
    debt_to_equity: de,
    interest_coverage: m.interest_coverage,
    pe_ratio: pe,
    pb_ratio: m.pb_ratio,
    eps_growth: m.eps_growth,
    revenue_growth_3yr: revCagr > 0 ? revCagr : m.revenue_growth,
    dividend_yield: divYield,
    roe_3yr_above_15: roe >= 15 ? 'yes' : 'no',
    roce_near_roe: Math.abs(roe - roce) <= 5 ? 'yes' : 'no',
    roe_from_operations: de <= 1.5 || Math.abs(roe - roce) <= 5 ? 'yes' : 'no',

    intrinsic_fair_pe: intrinsicPe,
    intrinsic_dcf: dcfIv,
    dcf_iv: dcfIv,
    vt_revenue_declining: vtDeclining ? '1' : '',
    vt_div_fcf_mismatch: vtDivFcf ? '1' : '',
    vt_debt_falling_margin: vtDebtMargin ? '1' : '',
    is_growth_stock: isGrowth ? '1' : '',
    p4_revenue_cagr: revCagr >= 15 ? 'yes' : 'no',
    p4_eps_growth_pace: m.eps_growth >= 10 ? 'yes' : 'no',
    p4_peg_ok: peg > 0 && peg <= 1.5 ? 'yes' : 'no',
    mr_price_reason: `52w range ₹${fmtNum(m['52w_low'])}–₹${fmtNum(m['52w_high'])}. Current ₹${fmtNum(price)}.`,
    mr_business_vs_sentiment:
      m.revenue_growth >= 0
        ? 'Fundamentals growing — check if price move is sentiment.'
        : 'Review if weakness is structural.',

    piotroski_score: fScore,
    altman_skip: altmanSkipFlag ? '1' : '',
    alt_sales: revs[revCount - 1] ?? '',
    p5_fscore_ok: fScore >= 7 ? 'yes' : '',
    p5_zscore_ok:
      altmanSkipFlag || (!altmanMeta.altman_unreliable && altmanMeta.altman_z > 2.99) ? 'yes' : '',
    p5_dcf_sanity: dcfIv >= price ? 'yes' : 'no',
    z_score_source: zSource,

    it_rev_growth: ['it', 'auto'].includes(sector) ? m.revenue_growth : '',
    auto_volume_growth: sector === 'auto' ? m.revenue_growth : '',
    bank_roa: sector === 'banking' ? m.roa : '',
    p6_kpi_identified: 'yes',
    p6_macro_noted: '',

    thesis_business: (m.summary || `${m.company_name} — leading ${m.industry}`).slice(0, 500),
    thesis_financials: `ROE ${roe}%, ROCE ${roce}%, D/E ${de}, FCF ₹${fmtNum(fcf)} Cr, revenue CAGR ~${revCagr}%.`,
    thesis_valuation: `P/E ${pe}, intrinsic ~₹${fmtNum(dcfIv)}, MOS ~${mos}%. Confirm before buying.`,
    invalidation_1: 'Revenue decline for 2 consecutive years',
    invalidation_2: 'ROE falls below 12% or promoter pledge exceeds 25%',
    auto_prefilled: '1',
  };

  if (!altmanSkipFlag && altmanBundle) {
    input.alt_wc = altmanBundle.wc;
    input.alt_retained = altmanBundle.retained;
    input.alt_ebit = altmanBundle.ebit;
    input.alt_total_assets = altmanBundle.totalAssets;
    input.alt_total_liabilities = altmanBundle.totalLiabilities;
    if (!altmanMeta.altman_unreliable && altmanMeta.altman_z > 0) {
      input.altman_z = altmanMeta.altman_z;
    }
  }

  if (m.gross_margin >= 40 && roe >= 20) input.moat_brand = '1';
  if (m.gross_margin >= 30) input.moat_cost = '1';
  if (sector === 'it') input.moat_switching = '1';

  const filtered: VerifyFullInput = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== '' && value !== null && value !== undefined) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/** Keys prefilled as drafts or meta — must not show AUTO badge or count as user-verified. */
export const VERIFIER_MANUAL_DRAFT_KEYS = new Set([
  'thesis_business',
  'thesis_financials',
  'thesis_valuation',
  'invalidation_1',
  'invalidation_2',
  'manual_attestation',
  'auto_prefilled',
  'fetch_symbol',
  'z_score_source',
]);

export function buildVerifierAutoFill(blob: VerifierFetchBlob): {
  input: VerifyFullInput;
  auto_keys: string[];
} {
  const input = mapToVerifierInput(blob);
  const auto_keys = Object.keys(input).filter((k) => !VERIFIER_MANUAL_DRAFT_KEYS.has(k));
  return { input, auto_keys };
}

export function metricsToVerifierBlob(
  metrics: StockMetrics,
  extras: {
    revenue_history?: number[];
    pat_cr?: number;
    shareholders_equity_cr?: number;
    summary?: string;
    promoter_pledge?: number;
    promoter_pledge_as_of?: string;
    peg?: number;
  } = {},
): VerifierFetchBlob {
  const price = Number(metrics.price ?? 0);
  const bookValue = Number(metrics.book_value ?? 0);
  const mcap = Number(metrics.market_cap_cr ?? 0);
  const equityCr =
    extras.shareholders_equity_cr && extras.shareholders_equity_cr > 0
      ? extras.shareholders_equity_cr
      : bookValue > 0 && mcap > 0 && price > 0
        ? Math.round((mcap / price) * bookValue)
        : 0;

  const revs = extras.revenue_history ?? [];
  const revCagr = revenueGrowth3yr(revs);
  const de = Number(metrics.debt_to_equity ?? 0);
  const sector = String(metrics.sector ?? 'general');

  let interestCoverage = Number(metrics.interest_coverage ?? 0);
  if (interestCoverage <= 0) {
    if (sector.toLowerCase().includes('bank')) interestCoverage = 10;
    else if (de <= 0.1) interestCoverage = 50;
    else if (de <= 0.5) interestCoverage = 8;
    else if (de <= 1) interestCoverage = 4;
    else interestCoverage = 1.5;
  }

  const pat =
    extras.pat_cr && extras.pat_cr > 0
      ? extras.pat_cr
      : revs.length
        ? 0
        : Math.round(mcap * 0.08);

  return {
    company_name: String(metrics.name ?? metrics.symbol),
    symbol: String(metrics.symbol),
    sector,
    industry: String(metrics.industry ?? ''),
    summary: extras.summary ?? '',
    current_price: price,
    market_cap_cr: mcap,
    eps: Number(metrics.eps ?? 0),
    eps_consolidated: Number(metrics.eps ?? 0),
    eps_standalone: 0,
    book_value: bookValue,
    book_value_consolidated: bookValue,
    book_value_standalone: 0,
    pe_ratio: Number(metrics.pe ?? 0),
    pb_ratio: Number(metrics.pb_ratio ?? 0),
    peg: extras.peg ?? Number((metrics as Record<string, unknown>).peg_ratio ?? 0),
    roe: Number(metrics.roe ?? 0),
    roce: Number(metrics.roce ?? 0),
    roa: Number(metrics.roa ?? 0),
    debt_to_equity: de,
    revenue_growth: Number(metrics.revenue_growth ?? metrics.sales_yoy ?? 0),
    revenue_growth_3yr: revCagr > 0 ? revCagr : Number(metrics.revenue_growth ?? 0),
    eps_growth: Number(metrics.eps_growth ?? metrics.profit_yoy ?? 0),
    dividend_yield: Number(metrics.div_yield ?? 0),
    fcf_cr: Number(metrics.fcf_cr ?? 0),
    cfo_cr: Number(metrics.cfo_cr ?? 0),
    capex_cr: Number(metrics.capex_cr ?? 0),
    pat_cr: pat,
    total_debt_cr: Number(metrics.total_debt_cr ?? 0),
    shareholders_equity_cr: equityCr,
    promoter_pledge: extras.promoter_pledge ?? 0,
    promoter_pledge_as_of: extras.promoter_pledge_as_of ?? '',
    interest_coverage: interestCoverage,
    ebitda_margin: Number(metrics.ebitda_margin ?? 0),
    gross_margin: Number(metrics.gross_margin ?? 0),
    revenue_history: revs,
    '52w_high': Number(metrics.high_52w ?? 0),
    '52w_low': Number(metrics.low_52w ?? 0),
  };
}
