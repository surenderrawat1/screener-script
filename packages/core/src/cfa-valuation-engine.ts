import type { StockMetrics } from '@sv/shared';
import { normalizeSector } from './valuation.js';
import {
  grahamCredible,
  altmanApplicable,
  altmanUsableForScoring,
  altmanZone,
  resolveAltmanMeta,
} from './quant-screen-helper.js';
import { grahamNumber, mosFromIntrinsic, resolveBookValue, resolveGrowthContext } from './valuation.js';

const MODEL_BY_SECTOR: Record<string, string> = {
  fmcg: 'dcf_fairpe_ddm',
  it: 'dcf_fairpe_ddm',
  pharma: 'dcf_fairpe_ddm',
  auto: 'dcf_fairpe_ddm',
  banking: 'pb',
  nbfc: 'pb',
  metal: 'ev_ebitda',
  cement: 'ev_ebitda',
  telecom: 'ev_ebitda',
  utility: 'ddm_dcf',
  reit: 'ddm_dcf',
  infra: 'ev_ebitda',
  defence: 'dcf_fairpe_ddm',
  oil_gas: 'ev_ebitda',
  insurance: 'pb',
  general: 'dcf_fairpe_ddm',
};

const FAIR_EV_EBITDA: Record<string, number> = {
  metal: 7,
  cement: 9,
  telecom: 6,
  infra: 8,
  oil_gas: 5.5,
};

function cagr(series: number[], years: number): number {
  const vals = series.filter((v) => v > 0);
  if (vals.length < 2) return 0;
  const use = vals.slice(-Math.min(vals.length, years + 1));
  if (use.length < 2) return 0;
  const first = use[0];
  const last = use[use.length - 1];
  const y = use.length - 1;
  return Math.round((Math.pow(last / first, 1 / y) - 1) * 10000) / 100;
}

function epsCagr5y(
  _stock: Record<string, unknown>,
  epsGrowth: number,
  rev3y: number,
  rev5y: number,
  patHistory: number[],
): number {
  const fromPat = cagr(patHistory, 5);
  if (fromPat > 0) return Math.min(fromPat, rev5y > 0 ? rev5y : fromPat);
  const candidates = [epsGrowth, rev3y, rev5y].filter((v) => v > 0);
  if (candidates.length === 0) return Math.max(-5, Math.min(epsGrowth, rev3y));
  return Math.round(Math.min(...candidates) * 100) / 100;
}

function normalizedEps(
  eps: number,
  epsGrowth: number,
  epsCagr5yVal: number,
  patHistory: number[],
  price: number,
  pe: number,
): number {
  if (eps <= 0) return 0;
  if (epsGrowth < -20 && epsCagr5yVal > 0) {
    return Math.round(eps * (1 + epsCagr5yVal / 200) * 100) / 100;
  }
  if (patHistory.length > 0 && price > 0 && pe > 0) {
    const avgPat = patHistory.reduce((a, b) => a + b, 0) / patHistory.length;
    const latestPat = patHistory[patHistory.length - 1];
    if (latestPat > 0 && avgPat > 0) {
      const adj = Math.min(1.15, Math.max(0.85, avgPat / latestPat));
      return Math.round(eps * adj * 100) / 100;
    }
  }
  return Math.round(eps * 100) / 100;
}

function normalizeDebtToEquity(de: number): number {
  if (de <= 0) return 0;
  if (de > 5) return Math.round((de / 100) * 1000) / 1000;
  return de;
}

function moatCount(stock: Record<string, unknown>): number {
  const explicit = Number(stock.moat_count ?? 0);
  if (explicit > 0) return explicit;
  let n = 0;
  for (const k of ['moat_brand', 'moat_cost', 'moat_switching', 'moat_network', 'moat_regulatory']) {
    if (stock[k]) n++;
  }
  if (n > 0) return n;
  const roce = Number(stock.roce ?? 0);
  const mcap = Number(stock.market_cap_cr ?? 0);
  if (roce >= 25 && mcap >= 50000) return 4;
  if (roce >= 18) return 3;
  if (roce >= 12) return 2;
  return 1;
}

function moatTier(ctx: Record<string, unknown>): string {
  const c = Number(ctx.moat_count ?? 0);
  if (c >= 5) return 'exceptional';
  if (c >= 3) return 'strong';
  if (c >= 2) return 'moderate';
  return 'weak';
}

function managementScore(stock: Record<string, unknown>): number {
  let score = 5;
  const pledge = Number(stock.promoter_pledge ?? stock.p1_promoter_pledge ?? 0);
  if (pledge <= 5) score += 2;
  else if (pledge > 25) score -= 3;
  if (stock.p1_auditor_clean === 'yes' || stock.p2_auditor_clean) score += 2;
  if (stock.p1_capital_allocation === 'yes') score += 1;
  return Math.max(0, Math.min(10, score));
}

export function normalizeSectorKey(sector: string): string {
  const s = sector.toLowerCase().trim();
  if (s.includes('nbfc') || s.includes('non-bank') || s.includes('housing finance')) return 'nbfc';
  if (s.includes('insurance') || s.includes('life ins')) return 'insurance';
  if (
    s.includes('oil') ||
    s.includes('gas') ||
    s.includes('petroleum') ||
    s.includes('refin') ||
    s.includes('exploration')
  )
    return 'oil_gas';
  if (s.includes('bank') || (s.includes('finance') && !s.includes('non-bank'))) return 'banking';
  if (s.includes('metal') || s.includes('steel') || s.includes('mining')) return 'metal';
  if (s.includes('cement')) return 'cement';
  if (s.includes('telecom')) return 'telecom';
  if ((s.includes('util') || s.includes('power')) && s.includes('gen')) return 'utility';
  if (s.includes('reit')) return 'reit';
  return normalizeSector(sector);
}

function sectorLabel(key: string): string {
  const map: Record<string, string> = {
    it: 'IT / Software',
    banking: 'Banking',
    nbfc: 'NBFC',
    insurance: 'Insurance',
    oil_gas: 'Oil & Gas',
    fmcg: 'FMCG',
    pharma: 'Pharma',
    auto: 'Auto',
    metal: 'Metals',
    cement: 'Cement',
    telecom: 'Telecom',
    utility: 'Utilities',
    reit: 'REIT',
    defence: 'Defence',
    infra: 'Infrastructure',
  };
  return map[key] ?? 'General';
}

export function normalizeContext(stock: Partial<StockMetrics> & Record<string, unknown>) {
  const price = Number(stock.price ?? stock.current_price ?? 0);
  let pe = Number(stock.pe ?? stock.pe_ratio ?? 0);
  let eps = Number(stock.eps ?? 0);
  if (eps <= 0 && pe > 0 && price > 0) eps = price / pe;

  const growth = resolveGrowthContext(stock);
  const bookValue = resolveBookValue(
    Number(stock.book_value ?? stock.book_value_latest ?? 0),
    eps,
    Number(stock.roe ?? 0),
  );

  const revHistory = Array.isArray(stock.revenue_history) ? (stock.revenue_history as number[]) : [];
  const patHistory = Array.isArray(stock.pat_history) ? (stock.pat_history as number[]) : [];
  const rev3y = revenueGrowth3yr(revHistory);
  const rev5y = cagr(revHistory, 5);
  const epsCagr5yVal = epsCagr5y(stock, growth.eps_growth, rev3y, rev5y, patHistory);

  const sectorRaw = String(stock.sector ?? stock.industry ?? 'general');
  const sectorKey = normalizeSectorKey(sectorRaw);

  const mcap = Number(stock.market_cap_cr ?? 0);
  const de = normalizeDebtToEquity(Number(stock.debt_to_equity ?? 0));
  const divYield = Number(stock.div_yield ?? stock.dividend_yield ?? 0);

  const normalizedEpsVal = normalizedEps(eps, growth.eps_growth, epsCagr5yVal, patHistory, price, pe);
  const moatCountVal = moatCount(stock);

  return {
    name: String(stock.name ?? stock.stock_name ?? stock.company_name ?? stock.symbol ?? ''),
    symbol: String(stock.symbol ?? ''),
    price,
    pe: pe > 0 ? pe : normalizedEpsVal > 0 && price > 0 ? price / normalizedEpsVal : 0,
    eps,
    normalized_eps: normalizedEpsVal,
    book_value: bookValue,
    pb_ratio: Number(stock.pb_ratio ?? (bookValue > 0 && price > 0 ? price / bookValue : 0)),
    roe: Number(stock.roe ?? 0),
    roce: Number(stock.roce ?? 0),
    debt_to_equity: de,
    div_yield: divYield,
    market_cap_cr: mcap,
    revenue_cr: Number(stock.revenue_cr ?? stock.revenue_latest_cr ?? 0) ||
      (revHistory.length ? revHistory[revHistory.length - 1] : 0),
    fcf_cr: Number(stock.fcf_cr ?? stock.fcf ?? 0),
    ebitda_cr: Number(stock.ebitda_cr ?? 0),
    ebitda_margin: Number(stock.ebitda_margin ?? stock.ebitda_margin_latest ?? 0),
    total_debt_cr: Number(stock.total_debt_cr ?? stock.total_debt ?? 0),
    eps_growth: growth.eps_growth,
    revenue_growth: growth.revenue_growth,
    revenue_growth_3yr: Number(stock.revenue_growth_3yr ?? rev3y),
    eps_cagr_5y: epsCagr5yVal,
    sector_raw: sectorRaw,
    sector_key: sectorKey,
    sector_label: sectorLabel(sectorKey),
    piotroski: Number(stock.piotroski_score ?? stock.piotroski ?? -1),
    altman_z: Number(stock.altman_z ?? 0),
    altman_skip: Boolean(stock.altman_skip),
    z_score_source: String(stock.z_score_source ?? 'missing'),
    use_graham_floor: Boolean(stock.use_graham_floor),
    moat_count: moatCountVal,
    management_score: managementScore(stock),
    cfo_cr: Number(stock.cfo_cr ?? stock.cfo ?? 0),
    pat_cr: Number(stock.pat_cr ?? stock.pat_latest ?? 0),
    summary: String(stock.summary ?? ''),
  };
}

export function revenueGrowth3yr(revenueHistory: number[]): number {
  return cagr(revenueHistory, 3);
}

export function resolveFcfPerShare(ctx: Record<string, unknown>) {
  const eps = Number(ctx.normalized_eps ?? ctx.eps ?? 0);
  const fcfCr = Number(ctx.fcf_cr ?? 0);
  const mcap = Number(ctx.market_cap_cr ?? 0);
  const price = Number(ctx.price ?? 0);
  if (fcfCr > 0 && mcap > 0 && price > 0) {
    const sharesCr = mcap / price;
    if (sharesCr > 0) return { value: fcfCr / sharesCr, source: 'reported' as const };
  }
  return { value: eps * 0.72, source: 'proxy' as const };
}

export function resolveEbitdaCr(ctx: Record<string, unknown>) {
  const ebitdaCr = Number(ctx.ebitda_cr ?? 0);
  if (ebitdaCr > 0) return { value: ebitdaCr, source: 'reported' as const };
  const revenueCr = Number(ctx.revenue_cr ?? ctx.revenue_latest_cr ?? 0);
  const margin = Number(ctx.ebitda_margin ?? 0);
  if (revenueCr > 0 && margin > 0) {
    return { value: Math.round(revenueCr * (margin / 100) * 100) / 100, source: 'estimated' as const };
  }
  return { value: 0, source: 'missing' as const };
}

function qualityScore(ctx: Record<string, unknown>) {
  const roe = Number(ctx.roe ?? 0);
  const roce = Number(ctx.roce ?? 0);
  const de = Number(ctx.debt_to_equity ?? 0);
  const sector = String(ctx.sector_key ?? '');
  const fScore = Number(ctx.piotroski ?? -1);
  const moatTierVal = moatTier(ctx);
  const mgmt = Number(ctx.management_score ?? 0);
  const fcf = Number(ctx.fcf_cr ?? 0);
  const cfo = Number(ctx.cfo_cr ?? 0);
  const pat = Number(ctx.pat_cr ?? 0);

  const roePts = Math.round(Math.min(20, Math.max(0, (roe / 25) * 20)));
  const rocePts = Math.round(Math.min(20, Math.max(0, (roce / 25) * 20)));

  let dePts = 3;
  if (sector === 'banking' || sector === 'nbfc') dePts = 12;
  else if (de <= 0.3) dePts = 15;
  else if (de <= 0.5) dePts = 12;
  else if (de <= 1.0) dePts = 8;

  const fPts = fScore >= 0 ? Math.round((fScore / 9) * 15) : 0;

  const moatPts =
    moatTierVal === 'exceptional' ? 15 : moatTierVal === 'strong' ? 11 : moatTierVal === 'moderate' ? 7 : 3;

  let cfPts = 0;
  if (fcf > 0 && cfo > 0 && pat > 0 && cfo >= pat * 0.7) cfPts = 5;
  else if (fcf > 0 || cfo > 0) cfPts = 3;

  let distressPts = 0;
  const zSource = String(ctx.z_score_source ?? 'missing');
  if (!ctx.altman_skip && altmanApplicable(sector)) {
    const z = Number(ctx.altman_z ?? 0);
    if (z > 0 && altmanUsableForScoring(zSource)) {
      distressPts = altmanZone(z) === 'safe' ? 5 : altmanZone(z) === 'grey' ? 2 : 0;
    }
  }

  const total = Math.min(100, roePts + rocePts + dePts + fPts + moatPts + mgmt + cfPts + distressPts);

  return {
    total,
    breakdown: {
      ROE: roePts,
      ROCE: rocePts,
      Debt: dePts,
      'F-Score': fPts,
      Moat: moatPts,
      Management: mgmt,
      'Cash Flow': cfPts,
      Distress: distressPts,
    },
    fair_pe_detail: {},
  };
}

export function fairPe(ctx: Record<string, unknown>, moatTierVal: string): number {
  const sector = String(ctx.sector_key ?? '');
  if (['banking', 'nbfc', 'insurance', 'metal', 'cement', 'telecom', 'oil_gas'].includes(sector)) {
    return 0;
  }

  const moatPrem =
    moatTierVal === 'exceptional' ? 5 : moatTierVal === 'strong' ? 3 : moatTierVal === 'moderate' ? 1 : 0;
  const mcap = Number(ctx.market_cap_cr ?? 0);
  const sizePrem = mcap >= 50000 ? 2 : mcap >= 5000 ? 0 : -2;
  const de = Number(ctx.debt_to_equity ?? 0);
  const debtPen = de < 0.3 ? 0 : de <= 1.0 ? 2 : 5;

  const raw =
    8 +
    0.4 * Number(ctx.eps_cagr_5y ?? 0) +
    0.1 * Number(ctx.roce ?? 0) +
    moatPrem +
    sizePrem -
    debtPen;

  return Math.round(Math.max(8, Math.min(40, raw)) * 10) / 10;
}

export function fairPeDetail(ctx: Record<string, unknown>, moatTierVal: string) {
  const sector = String(ctx.sector_key ?? '');
  const fairPeVal = fairPe(ctx, moatTierVal);
  if (fairPeVal <= 0) {
    return {
      fair_pe: 0,
      sector_key: sector,
      moat_tier: moatTierVal,
      rationale: `Fair P/E not primary for ${sector || 'this'} sector; model uses ${MODEL_BY_SECTOR[sector] ?? 'sector-specific'} valuation.`,
    };
  }

  const epsCagr = Number(ctx.eps_cagr_5y ?? 0);
  const roce = Number(ctx.roce ?? 0);
  const mcap = Number(ctx.market_cap_cr ?? 0);
  const de = Number(ctx.debt_to_equity ?? 0);
  const moatPrem =
    moatTierVal === 'exceptional' ? 5 : moatTierVal === 'strong' ? 3 : moatTierVal === 'moderate' ? 1 : 0;
  const sizePrem = mcap >= 50000 ? 2 : mcap >= 5000 ? 0 : -2;
  const debtPen = de < 0.3 ? 0 : de <= 1.0 ? 2 : 5;

  return {
    fair_pe: fairPeVal,
    sector_key: sector,
    moat_tier: moatTierVal,
    eps_cagr_5y: epsCagr,
    roce,
    moat_premium: moatPrem,
    size_premium: sizePrem,
    debt_penalty: debtPen,
    rationale:
      `Fair P/E ${fairPeVal}x from production CFA engine: 8 + 0.4x EPS CAGR (${epsCagr}%) + 0.1x ROCE (${roce}%) + moat ${moatPrem} + size ${sizePrem} - debt ${debtPen}.`,
  };
}

export function dcfValue(ctx: Record<string, unknown>, fcfPs?: number): number {
  const eps = Number(ctx.normalized_eps ?? 0);
  if (eps <= 0) return 0;

  const growth = Math.min(12, Math.max(0, Number(ctx.eps_cagr_5y ?? 0) * 0.85));
  const terminal = 3;
  const waccMap: Record<string, number> = {
    it: 10.5,
    pharma: 10.5,
    fmcg: 10.5,
    banking: 12,
    nbfc: 12,
    metal: 11.5,
    cement: 11.5,
  };
  const wacc = (waccMap[String(ctx.sector_key ?? '')] ?? 11) / 100;

  const fcf = fcfPs ?? resolveFcfPerShare(ctx).value;
  let pv = 0;
  let cf = fcf;
  for (let y = 1; y <= 5; y++) {
    cf *= 1 + growth / 100;
    pv += cf / Math.pow(1 + wacc, y);
  }
  const termVal = (cf * (1 + terminal / 100)) / (wacc - terminal / 100);
  pv += termVal / Math.pow(1 + wacc, 5);

  return Math.round(Math.max(0, pv) * 100) / 100;
}

export function ddmValue(ctx: Record<string, unknown>): number {
  const divYield = Number(ctx.div_yield ?? 0);
  const price = Number(ctx.price ?? 0);
  if (divYield < 0.5 || price <= 0) return 0;

  const d0 = price * (divYield / 100);
  const g = Math.min(8, Math.max(2, Number(ctx.eps_cagr_5y ?? 0) * 0.6)) / 100;
  const r = 0.12;
  if (r <= g) return Math.round((d0 / (r - 0.02)) * 100) / 100;
  return Math.round(((d0 * (1 + g)) / (r - g)) * 100) / 100;
}

export function pbValue(ctx: Record<string, unknown>): number {
  const bv = Number(ctx.book_value ?? 0);
  if (bv <= 0) return 0;
  const roe = Number(ctx.roe ?? 0);
  const fairPb =
    ctx.sector_key === 'insurance'
      ? Math.max(1.2, Math.min(2, 1 + (roe - 10) * 0.05))
      : Math.max(0.8, Math.min(3.2, 0.6 + (roe - 8) * 0.07));
  return Math.round(bv * fairPb * 100) / 100;
}

export function evEbitdaValue(ctx: Record<string, unknown>, ebitdaCr?: number): number {
  const mcap = Number(ctx.market_cap_cr ?? 0);
  const price = Number(ctx.price ?? 0);
  if (mcap <= 0 || price <= 0) return 0;

  const ebitda = ebitdaCr ?? resolveEbitdaCr(ctx).value;
  if (ebitda <= 0) return 0;

  const fairMult = FAIR_EV_EBITDA[String(ctx.sector_key ?? '')] ?? 7.5;
  const fairEv = fairMult * ebitda;
  const netDebt = Math.max(0, Number(ctx.total_debt_cr ?? 0) * 0.85);
  const fairEquity = Math.max(0, fairEv - netDebt);
  const sharesCr = mcap / price;
  if (sharesCr <= 0) return 0;

  return Math.round((fairEquity / sharesCr) * 100) / 100;
}

function blendDcfFairPeDdm(ctx: Record<string, unknown>, dcf: number, peIv: number, ddm: number): number {
  if (Number(ctx.div_yield ?? 0) >= 1 && ddm > 0 && dcf > 0 && peIv > 0) {
    return Math.round((0.5 * dcf + 0.3 * peIv + 0.2 * ddm) * 100) / 100;
  }
  if (dcf > 0 && peIv > 0) return Math.round((0.7 * dcf + 0.3 * peIv) * 100) / 100;
  return Math.max(dcf, peIv, ddm);
}

function blendIntrinsic(
  ctx: Record<string, unknown>,
  model: string,
  dcf: number,
  peIv: number,
  ddm: number,
  pb: number,
  ev: number,
): number {
  let iv = 0;
  switch (model) {
    case 'pb':
      iv = pb;
      break;
    case 'ev_ebitda':
      iv = ev;
      break;
    case 'ddm_dcf':
      iv = ddm > 0 && dcf > 0 ? Math.round((0.5 * dcf + 0.5 * ddm) * 100) / 100 : Math.max(dcf, ddm);
      break;
    default:
      iv = blendDcfFairPeDdm(ctx, dcf, peIv, ddm);
  }
  return iv > 0 ? iv : Math.max(dcf, peIv, ddm, pb, ev);
}

function applyGrahamFloor(
  ctx: Record<string, unknown>,
  sectorKey: string,
  graham: number,
  intrinsic: number,
  flags: string[],
): number {
  const useFloor = Boolean(ctx.use_graham_floor) || process.env.SV_GRAHAM_FLOOR === '1';
  if (!useFloor || graham <= 0 || !grahamCredible(sectorKey, ctx)) return intrinsic;
  const floor = Math.round(graham * 0.85 * 100) / 100;
  if (floor > intrinsic) {
    flags.push('graham_floor_active');
    return floor;
  }
  return intrinsic;
}

export function buildValuationFlags(
  model: string,
  fcfResolved: { source: string },
  ebitdaResolved: { source: string },
): string[] {
  const flags: string[] = [];
  const usesDcf = ['dcf_fairpe_ddm', 'ddm_dcf'].includes(model);
  if (usesDcf && fcfResolved.source === 'proxy') flags.push('dcf_fcf_proxy');
  if (model === 'ev_ebitda' && ebitdaResolved.source === 'estimated') flags.push('ebitda_estimated');
  return flags;
}

function finalRating(mos: number | null) {
  if (mos === null) return { label: 'Insufficient Data', tier: 'unknown', color: 'neutral' };
  if (mos > 40) return { label: 'Strong Buy', tier: 'strong_buy', color: 'green' };
  if (mos >= 25) return { label: 'Buy', tier: 'buy', color: 'green' };
  if (mos >= 10) return { label: 'Accumulate', tier: 'accumulate', color: 'amber' };
  if (mos >= 0) return { label: 'Hold', tier: 'hold', color: 'neutral' };
  return { label: 'Expensive', tier: 'expensive', color: 'red' };
}

function mosZone(mos: number | null): string {
  return finalRating(mos).label === 'Insufficient Data' ? 'Unknown' : finalRating(mos).label;
}

function methodLabel(model: string, ctx: Record<string, unknown>): string {
  switch (model) {
    case 'pb':
      return ctx.sector_key === 'insurance' ? 'P/B (Insurance)' : 'P/B (Bank/NBFC)';
    case 'ev_ebitda':
      return ctx.sector_key === 'oil_gas' ? 'EV/EBITDA (Oil & Gas)' : 'EV/EBITDA';
    case 'ddm_dcf':
      return 'DDM + DCF';
    default:
      return Number(ctx.div_yield ?? 0) >= 1 ? 'DCF + Fair P/E + DDM' : 'DCF + Fair P/E';
  }
}

export function analyze(stock: Partial<StockMetrics> & Record<string, unknown>) {
  const ctx = normalizeContext(stock);
  const altmanMeta = resolveAltmanMeta(ctx.sector_key, { ...ctx, ...stock });
  Object.assign(ctx, altmanMeta);

  const sectorKey = ctx.sector_key;
  const model = MODEL_BY_SECTOR[sectorKey] ?? 'dcf_fairpe_ddm';

  const quality = qualityScore(ctx);
  const moatTierVal = moatTier(ctx);
  const fairPeInfo = fairPeDetail(ctx, moatTierVal);
  const fairPeVal = fairPeInfo.fair_pe;
  const fcfResolved = resolveFcfPerShare(ctx);
  const ebitdaResolved = resolveEbitdaCr(ctx);
  const dcf = dcfValue(ctx, fcfResolved.value);
  const ddm = ddmValue(ctx);
  const pbVal = pbValue(ctx);
  const evVal = evEbitdaValue(ctx, ebitdaResolved.value);

  const peIntrinsic =
    ctx.normalized_eps > 0 && fairPeVal > 0
      ? Math.round(ctx.normalized_eps * fairPeVal * 100) / 100
      : 0;

  let intrinsic = blendIntrinsic(ctx, model, dcf, peIntrinsic, ddm, pbVal, evVal);
  const graham = grahamNumber(ctx.normalized_eps, ctx.book_value);
  const flags = buildValuationFlags(model, fcfResolved, ebitdaResolved);
  if (altmanMeta.altman_unreliable) flags.push('altman_unreliable');

  intrinsic = applyGrahamFloor(ctx, sectorKey, graham, intrinsic, flags);
  const mos = mosFromIntrinsic(intrinsic, ctx.price);
  if (mos !== null && Math.abs(mos) > 50) flags.push('mos_extreme');

  const rating = finalRating(mos);

  return {
    business_summary: `${ctx.name} (${ctx.sector_label})`,
    sector: ctx.sector_label,
    sector_key: sectorKey,
    valuation_model: model,
    quality_score: quality.total,
    quality_breakdown: quality.breakdown,
    fair_pe: fairPeVal,
    fair_pe_detail: fairPeInfo,
    dcf_value: dcf,
    pe_intrinsic: peIntrinsic,
    pb_value: pbVal,
    ev_ebitda_value: evVal,
    ddm_value: ddm,
    intrinsic,
    intrinsic_value: intrinsic,
    mos,
    margin_of_safety: mos,
    mos_zone: mosZone(mos),
    mos_action: rating.label,
    final_rating: rating.label,
    rating_tier: rating.tier,
    normalized_eps: ctx.normalized_eps,
    eps_cagr_5y: ctx.eps_cagr_5y,
    method: methodLabel(model, ctx),
    graham,
    graham_credible: grahamCredible(sectorKey, ctx),
    altman_z: ctx.altman_z,
    z_score_source: ctx.z_score_source,
    fcf_source: fcfResolved.source,
    ebitda_source: ebitdaResolved.source,
    valuation_flags: flags,
    moat_tier: moatTierVal,
    moat_count: ctx.moat_count,
  };
}

export function moatTierRank(tier: string): number {
  if (tier === 'exceptional') return 3;
  if (tier === 'strong') return 2;
  if (tier === 'moderate') return 1;
  return 0;
}
