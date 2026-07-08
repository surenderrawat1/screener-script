import { compute } from '../mos-helper.js';
import {
  altmanSkip,
  grahamCredible,
  grahamLabel,
  resolveAltmanMeta,
} from '../quant-screen-helper.js';
import { resolveBookValue, resolveGrowthContext } from '../valuation.js';
import type { DerivedMetrics, VerifyInput } from './types.js';
import { resolveEffectiveSectorKey } from './sector-routing.js';

function mosZoneFallback(mos: number | null): string {
  if (mos === null) return 'Unknown';
  if (mos >= 25) return 'Deep value';
  if (mos >= 15) return 'Buy zone';
  if (mos >= 0) return 'Fair';
  return 'Expensive';
}

function revenueTrend(input: VerifyInput): string {
  const revs = [
    Number(input.revenue_y4 ?? 0),
    Number(input.revenue_y3 ?? 0),
    Number(input.revenue_y2 ?? 0),
    Number(input.revenue_y1 ?? 0),
    Number(input.revenue_latest ?? 0),
  ].filter((v) => v > 0);

  if (revs.length < 2) return 'unknown';

  let growing = true;
  for (let i = 1; i < revs.length; i++) {
    if (revs[i]! < revs[i - 1]!) {
      growing = false;
      break;
    }
  }
  return growing ? 'growing' : 'declining';
}

function moatLabel(count: number): string {
  if (count >= 4) return 'Strong moat';
  if (count >= 2) return 'Moderate moat';
  if (count >= 1) return 'Weak moat';
  return 'No visible moat';
}

export function computeDerivedMetrics(
  input: VerifyInput,
  sectorHints: Record<string, string> = {},
): DerivedMetrics {
  const i = { ...input };
  const price = Number(i.current_price ?? 0);
  const eps = Number(i.eps ?? 0);
  const bv = resolveBookValue(
    Number(i.book_value_latest ?? 0),
    eps,
    Number(i.roe ?? 0),
  );

  let pe = Number(i.pe_ratio ?? 0);
  if (pe <= 0) pe = eps > 0 ? price / eps : 0;

  let pb = Number(i.pb_ratio ?? 0);
  if (pb <= 0) pb = bv > 0 ? price / bv : 0;

  const peg = pe > 0 && Number(i.eps_growth ?? 0) > 0 ? pe / Number(i.eps_growth) : 0;

  const growth = resolveGrowthContext({
    eps_growth: Number(i.eps_growth ?? 0),
    revenue_growth_3yr: Number(i.revenue_growth_3yr ?? 0),
  });

  let de = Number(i.debt_to_equity ?? 0);
  if (de <= 0 && Number(i.shareholders_equity ?? 0) > 0) {
    de = Number(i.total_debt ?? 0) / Number(i.shareholders_equity);
  }

  let fcf = Number(i.fcf ?? 0);
  if (fcf === 0 && Number(i.cfo ?? 0) !== 0) {
    fcf = Number(i.cfo) - Math.abs(Number(i.capex ?? 0));
  }

  const moatCount =
    Number(i.moat_brand ? 1 : 0) +
    Number(i.moat_cost ? 1 : 0) +
    Number(i.moat_switching ? 1 : 0) +
    Number(i.moat_network ? 1 : 0) +
    Number(i.moat_regulatory ? 1 : 0);

  const sectorKey = resolveEffectiveSectorKey(i, sectorHints);
  if (altmanSkip(sectorKey)) {
    i.altman_skip = true;
  }

  let altmanZ = Number(i.altman_z ?? 0);
  let zSource = String(i.z_score_source ?? '').trim();

  if (altmanZ <= 0 && Number(i.alt_total_assets ?? 0) > 0 && !i.altman_skip) {
    const ta = Number(i.alt_total_assets);
    const tl = Math.max(Number(i.alt_total_liabilities ?? 0), 0.01);
    const a = Number(i.alt_wc ?? 0) / ta;
    const b = Number(i.alt_retained ?? 0) / ta;
    const c = Number(i.alt_ebit ?? 0) / ta;
    const d = Number(i.market_cap_cr ?? 0) / tl;
    const e = Number(i.alt_sales ?? 0) / ta;
    altmanZ = 1.2 * a + 1.4 * b + 3.3 * c + 0.6 * d + 1.0 * e;
    zSource = 'computed';
  }

  if (altmanZ > 0 && zSource === '') {
    zSource = Number(i.altman_z ?? 0) > 0 ? 'reported' : 'computed';
  }
  if (i.altman_skip) {
    zSource = 'skipped';
  }

  const altmanMeta = resolveAltmanMeta(sectorKey, {
    altman_z: altmanZ,
    altman_skip: i.altman_skip,
    z_score_source: zSource,
  });
  altmanZ = altmanMeta.altman_z;
  zSource = altmanMeta.z_score_source;

  const stockCtx: Record<string, unknown> = {
    ...i,
    price,
    current_price: price,
    book_value: bv,
    pe,
    pe_ratio: pe,
    pb_ratio: pb,
    div_yield: Number(i.dividend_yield ?? 0),
    market_cap_cr: Number(i.market_cap_cr ?? 0),
    revenue_growth_3yr: Number(i.revenue_growth_3yr ?? 0),
    piotroski_score: Number(i.piotroski_score ?? -1),
    altman_z: altmanZ,
    altman_skip: i.altman_skip,
    z_score_source: zSource,
    moat_count: moatCount,
    fcf_cr: fcf,
    ebitda_cr: Number(i.ebitda_cr ?? i.ebitda ?? 0),
    cfo_cr: Number(i.cfo ?? 0),
    pat_cr: Number(i.pat_latest ?? 0),
    ebitda_margin: Number(i.ebitda_margin_latest ?? 0),
    total_debt_cr: Number(i.total_debt ?? 0),
    revenue_y4: i.revenue_y4 ?? '',
    revenue_y3: i.revenue_y3 ?? '',
    revenue_y2: i.revenue_y2 ?? '',
    revenue_y1: i.revenue_y1 ?? '',
    revenue_latest: i.revenue_latest ?? '',
    use_graham_floor: Boolean(i.use_graham_floor),
    sector: sectorKey,
  };

  stockCtx.revenue_history = [
    Number(i.revenue_y4 ?? 0),
    Number(i.revenue_y3 ?? 0),
    Number(i.revenue_y2 ?? 0),
    Number(i.revenue_y1 ?? 0),
    Number(i.revenue_latest ?? 0),
  ].filter((v) => v > 0);

  const mosCalc = compute(price, eps, growth.eps_growth, bv, pe, stockCtx);
  const cfa = mosCalc.cfa_report as Record<string, unknown>;
  const intrinsic = Number(mosCalc.intrinsic);
  const graham = Number(mosCalc.graham);
  const mos = mosCalc.mos === null ? null : Number(mosCalc.mos);

  const fcfYield =
    Number(i.market_cap_cr ?? 0) > 0 && fcf > 0
      ? (fcf / Number(i.market_cap_cr)) * 100
      : 0;

  const valueTrapCount =
    Number(i.vt_revenue_declining ? 1 : 0) +
    Number(i.vt_div_fcf_mismatch ? 1 : 0) +
    Number(i.vt_industry_disrupted ? 1 : 0) +
    Number(i.vt_debt_falling_margin ? 1 : 0) +
    Number(i.vt_permanent_decline ? 1 : 0);

  const grahamCred = grahamCredible(sectorKey, {
    ...stockCtx,
    normalized_eps: eps,
    profit_yoy: Number(i.eps_growth ?? 0),
    sales_yoy: Number(i.revenue_growth_3yr ?? 0),
  });

  const revenueTrendVal = revenueTrend(i);

  return {
    eps_mode: String(i.eps_mode ?? 'consolidated'),
    eps: Math.round(eps * 100) / 100,
    eps_consolidated: Math.round(Number(i.eps_consolidated ?? eps) * 100) / 100,
    eps_standalone: Math.round(Number(i.eps_standalone ?? 0) * 100) / 100,
    pe: Math.round(pe * 100) / 100,
    pb: Math.round(pb * 100) / 100,
    peg: Math.round(peg * 100) / 100,
    de: Math.round(de * 100) / 100,
    graham_number: Math.round(graham * 100) / 100,
    graham_credible: grahamCred,
    graham_label: grahamLabel(grahamCred),
    intrinsic_value: Math.round(intrinsic * 100) / 100,
    intrinsic_pe: Math.round(Number(mosCalc.intrinsic_pe) * 100) / 100,
    fair_pe: Math.round(Number(mosCalc.fair_pe) * 10) / 10,
    fair_pe_detail: mosCalc.fair_pe_detail,
    mos_method: String(mosCalc.method ?? ''),
    margin_of_safety: mos === null ? null : Math.round(mos * 10) / 10,
    fcf: Math.round(fcf * 100) / 100,
    fcf_yield: Math.round(fcfYield * 100) / 100,
    moat_count: moatCount,
    moat_strength: moatLabel(moatCount),
    value_trap_count: valueTrapCount,
    altman_z: Math.round(altmanZ * 100) / 100,
    altman_zone: altmanMeta.altman_zone,
    altman_skip: altmanMeta.altman_skip,
    altman_unreliable: Boolean(altmanMeta.altman_unreliable),
    z_score_source: zSource !== '' ? zSource : 'missing',
    revenue_trend: revenueTrendVal,
    piotroski: Number(i.piotroski_score ?? -1),
    quality_score: Number(cfa.quality_score ?? 0),
    quality_breakdown:
      cfa.quality_breakdown &&
      typeof cfa.quality_breakdown === 'object' &&
      !Array.isArray(cfa.quality_breakdown)
        ? (cfa.quality_breakdown as Record<string, number>)
        : {},
    dcf_value: Number(cfa.dcf_value ?? 0),
    alt_value: Number(cfa.alt_value ?? 0),
    alt_label: String(cfa.alt_label ?? ''),
    valuation_model: String(cfa.valuation_model ?? ''),
    final_rating: String(cfa.final_rating ?? ''),
    business_summary: String(cfa.business_summary ?? ''),
    key_risks: Array.isArray(cfa.key_risks) ? (cfa.key_risks as string[]) : [],
    sector_label: String(cfa.sector ?? ''),
    mos_zone: String(cfa.mos_zone ?? mosZoneFallback(mos)),
    fcf_source: String(cfa.fcf_source ?? ''),
    ebitda_source: String(cfa.ebitda_source ?? ''),
    valuation_flags: Array.isArray(cfa.valuation_flags) ? (cfa.valuation_flags as string[]) : [],
    sector_key: sectorKey,
  };
}
