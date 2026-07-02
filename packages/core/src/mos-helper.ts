import type { StockMetrics } from '@sv/shared';
import * as CfaValuationEngine from './cfa-valuation-engine.js';
import { grahamLabel, resolveAltmanMeta } from './quant-screen-helper.js';
import {
  calculateFairPe,
  grahamNumber,
  isMosExtreme,
  mosFromIntrinsic,
  resolveBookValue,
  resolveGrowthContext,
} from './valuation.js';

export function estimate(stock: Partial<StockMetrics> & Record<string, unknown>) {
  const price = Number(stock.price ?? stock.current_price ?? 0);
  const pe = Number(stock.pe ?? stock.pe_ratio ?? 0);
  const growth = resolveGrowthContext(stock);
  let eps = Number(stock.eps ?? 0);
  if (eps <= 0 && pe > 0 && price > 0) eps = price / pe;

  const bookValue = resolveBookValue(Number(stock.book_value ?? 0), eps, Number(stock.roe ?? 0));
  const sectorKey = CfaValuationEngine.normalizeSectorKey(String(stock.sector ?? 'general'));
  const divYield = Number(stock.div_yield ?? stock.dividend_yield ?? 0);
  const canValueWithoutEps = [
    'banking',
    'nbfc',
    'reit',
    'utility',
    'metal',
    'cement',
    'telecom',
    'infra',
  ].includes(sectorKey) || (divYield >= 0.5 && price > 0);

  if (price <= 0 || (eps <= 0 && pe <= 0 && !canValueWithoutEps)) {
    return emptyEstimate();
  }

  const ctx = {
    ...stock,
    price,
    current_price: price,
    eps,
    book_value: bookValue,
    pe,
    pe_ratio: pe,
    eps_growth: growth.eps_growth,
    profit_yoy: growth.eps_growth,
    revenue_growth: growth.revenue_growth,
  };

  const r = CfaValuationEngine.analyze(ctx);
  const altmanMeta = resolveAltmanMeta(sectorKey, ctx);

  return {
    intrinsic: Number(r.intrinsic),
    intrinsic_pe: Number(r.pe_intrinsic ?? 0),
    mos: r.mos,
    mos_pe: mosFromIntrinsic(Number(r.pe_intrinsic ?? 0), price),
    zone: r.mos_zone ?? 'Unknown',
    action: r.mos_action ?? '',
    fair_pe: Number(r.fair_pe ?? 0),
    method: r.method ?? '',
    graham: Number(r.graham ?? 0),
    graham_mos: mosFromIntrinsic(Number(r.graham ?? 0), price),
    graham_credible: Boolean(r.graham_credible),
    graham_label: grahamLabel(Boolean(r.graham_credible)),
    altman_z: altmanMeta.altman_z,
    altman_skip: altmanMeta.altman_skip,
    altman_zone: altmanMeta.altman_zone,
    z_score_source: altmanMeta.z_score_source,
    altman_unreliable: altmanMeta.altman_unreliable,
    eps,
    book_value: bookValue,
    cfa_report: r,
    quality_score: Number(r.quality_score ?? 0),
    dcf_value: Number(r.dcf_value ?? 0),
    final_rating: r.final_rating ?? '',
    valuation_flags: r.valuation_flags ?? [],
  };
}

function emptyEstimate() {
  return {
    intrinsic: 0,
    mos: null as number | null,
    zone: 'Unknown',
    action: 'Run full verify for MOS',
    fair_pe: 0,
    method: 'none',
    graham: 0,
    graham_mos: null as number | null,
    graham_credible: false,
    graham_label: grahamLabel(false),
    altman_z: 0,
    altman_skip: false,
    altman_zone: 'unknown',
    z_score_source: 'missing',
    altman_unreliable: false,
    quality_score: 0,
    final_rating: 'Unknown',
    cfa_report: {},
  };
}

export function compute(
  price: number,
  eps: number,
  epsGrowth: number,
  bookValue = 0,
  pe = 0,
  context: Record<string, unknown> = {},
) {
  const stock = {
    symbol: String(context.symbol ?? 'UNKNOWN'),
    price,
    current_price: price,
    eps,
    eps_growth: epsGrowth,
    profit_yoy: epsGrowth,
    book_value: bookValue,
    pe,
    pe_ratio: pe,
    ...context,
  };
  const r = CfaValuationEngine.analyze(stock);
  const growth = resolveGrowthContext(stock);
  const fairPeDetail = calculateFairPe(growth.eps_growth, {
    sector: String(context.sector ?? 'general'),
    roe: Number(context.roe ?? 0),
    roce: Number(context.roce ?? 0),
    revenue_growth: growth.revenue_growth,
  });

  return {
    intrinsic: Number(r.intrinsic),
    intrinsic_pe: Number(r.pe_intrinsic ?? 0),
    graham: Number(r.graham ?? 0),
    graham_mos: mosFromIntrinsic(Number(r.graham ?? 0), price),
    graham_credible: Boolean(r.graham_credible),
    mos_pe: mosFromIntrinsic(Number(r.pe_intrinsic ?? 0), price),
    fair_pe: Number(r.fair_pe ?? 0),
    fair_pe_detail: fairPeDetail,
    mos: r.mos,
    method: r.method ?? '',
    zone: r.mos_zone ?? 'Unknown',
    action: r.mos_action ?? '',
    cfa_report: r,
  };
}

export { isMosExtreme, mosFromIntrinsic, grahamNumber };
