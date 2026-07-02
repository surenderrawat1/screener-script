import type { StockMetrics } from '@sv/shared';

type SectorBand = { base: number; min: number; max: number };

const SECTOR: Record<string, SectorBand> = {
  it: { base: 22, min: 14, max: 32 },
  banking: { base: 12, min: 8, max: 18 },
  nbfc: { base: 14, min: 10, max: 20 },
  oil_gas: { base: 8, min: 5, max: 12 },
  insurance: { base: 18, min: 12, max: 25 },
  fmcg: { base: 40, min: 28, max: 55 },
  pharma: { base: 25, min: 18, max: 35 },
  auto: { base: 18, min: 12, max: 26 },
  infra: { base: 14, min: 10, max: 20 },
  defence: { base: 20, min: 14, max: 28 },
  general: { base: 16, min: 10, max: 28 },
};

export function normalizeSector(sector: string): string {
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
  if (s.includes('it') || s.includes('software') || s.includes('tech')) return 'it';
  if (s.includes('fmcg') || s.includes('consumer')) return 'fmcg';
  if (s.includes('pharma') || s.includes('health')) return 'pharma';
  if (s.includes('auto')) return 'auto';
  if (s.includes('infra') || s.includes('power')) return 'infra';
  if (s.includes('defence') || s.includes('defense')) return 'defence';
  return 'general';
}

function sectorNormGrowth(sector: string): number {
  const map: Record<string, number> = {
    it: 10,
    banking: 12,
    nbfc: 12,
    oil_gas: 6,
    insurance: 10,
    fmcg: 8,
    pharma: 11,
    auto: 9,
    infra: 8,
    defence: 12,
  };
  return map[sector] ?? 8;
}

function sustainableGrowth(epsGrowth: number, revGrowth: number, sector: string): number {
  const norm = sectorNormGrowth(sector);
  if (epsGrowth < -15 && revGrowth > -3) {
    return Math.max(norm * 0.6, revGrowth > 0 ? revGrowth * 0.7 + norm * 0.3 : norm * 0.75);
  }
  if (Math.abs(epsGrowth) > 35) {
    return revGrowth > 0 ? Math.min(revGrowth, norm + 5) : norm;
  }
  if (epsGrowth > 0 && revGrowth > 0) {
    return Math.min(epsGrowth, revGrowth) * 0.6 + Math.max(epsGrowth, revGrowth) * 0.4;
  }
  if (epsGrowth > 0) return Math.min(epsGrowth, norm + 8);
  if (revGrowth > 0) return revGrowth * 0.75;
  return norm;
}

function pegTarget(roe: number, roce: number, sector: string): number {
  let peg = 1.05;
  if (roe >= 25 && roce >= 20) peg = 1.4;
  else if (roe >= 20 && roce >= 15) peg = 1.3;
  else if (roe >= 15) peg = 1.2;
  if (sector === 'banking' || sector === 'nbfc') peg = Math.min(peg, 1.15);
  if (sector === 'fmcg') peg = Math.max(peg, 1.25);
  return peg;
}

function qualityPremium(roe: number, roce: number): number {
  let premium = 0;
  if (roe >= 30) premium = 5;
  else if (roe >= 25) premium = 4;
  else if (roe >= 20) premium = 3;
  else if (roe >= 15) premium = 2;
  else if (roe >= 12) premium = 1;
  if (roce >= 20 && roe > 0 && Math.abs(roce - roe) <= 8) premium += 1;
  return premium;
}

function blendWeights(sector: string, roe: number, roce: number) {
  if (sector === 'banking' || sector === 'nbfc') {
    return { peg: 0.25, quality: 0.35, sector: 0.4 };
  }
  if (roe >= 20 && roce >= 15) {
    return { peg: 0.3, quality: 0.45, sector: 0.25 };
  }
  return { peg: 0.4, quality: 0.3, sector: 0.3 };
}

export interface FairPeResult {
  fair_pe: number;
  growth_used: number;
  peg_target: number;
  sector_key: string;
  rationale: string;
}

export function calculateFairPe(
  epsGrowth: number,
  context: { sector?: string; roe?: number; roce?: number; revenue_growth?: number } = {},
): FairPeResult {
  const sectorKey = normalizeSector(context.sector ?? 'general');
  const roe = context.roe ?? 0;
  const roce = context.roce ?? 0;
  const revGrowth = context.revenue_growth ?? epsGrowth;

  const growth = sustainableGrowth(epsGrowth, revGrowth, sectorKey);
  const sector = SECTOR[sectorKey] ?? SECTOR.general;

  const pegT = pegTarget(roe, roce, sectorKey);
  const growthForPe = Math.max(0, growth);
  const pegPe = growthForPe > 0 ? growthForPe * pegT : sector.base;

  const qPremium = qualityPremium(roe, roce);
  const qualityPe = sector.base + qPremium + growthForPe * 0.25;

  let sectorPe = sector.base;
  if (growthForPe >= 15) sectorPe += Math.min(4, (growthForPe - 15) * 0.2);
  else if (growthForPe < 5) sectorPe -= Math.min(3, (5 - growthForPe) * 0.4);

  const components = {
    peg: Math.round(pegPe * 100) / 100,
    quality: Math.round(qualityPe * 100) / 100,
    sector: Math.round(sectorPe * 100) / 100,
  };
  const weights = blendWeights(sectorKey, roe, roce);
  const raw =
    components.peg * weights.peg +
    components.quality * weights.quality +
    components.sector * weights.sector;
  const fairPe = Math.max(sector.min, Math.min(sector.max, Math.round(raw * 10) / 10));

  return {
    fair_pe: fairPe,
    growth_used: Math.round(growth * 10) / 10,
    peg_target: pegT,
    sector_key: sectorKey,
    rationale: `Fair P/E ${fairPe}× — ${sectorKey.toUpperCase()} sector · growth ${growth.toFixed(1)}%`,
  };
}

export function resolveGrowthContext(stock: Partial<StockMetrics>) {
  const epsGrowth = Number(stock.eps_growth ?? stock.profit_yoy ?? 0);
  const rev1y = Number(stock.sales_yoy ?? stock.revenue_growth ?? 0);
  const rev3y = Number(stock.revenue_growth_3yr ?? 0);
  const revenueGrowth = rev3y > 0 ? rev3y : rev1y > 0 ? rev1y : epsGrowth;
  return { eps_growth: epsGrowth, revenue_growth: revenueGrowth };
}

export function resolveBookValue(bookValue: number, eps: number, roe: number): number {
  if (bookValue > 0) return bookValue;
  if (eps > 0 && roe > 0) return Math.round((eps * 100) / roe * 100) / 100;
  return 0;
}

export function grahamNumber(eps: number, bookValue: number): number {
  if (eps <= 0 || bookValue <= 0) return 0;
  return Math.round(Math.sqrt(22.5 * eps * bookValue) * 100) / 100;
}

export function mosFromIntrinsic(intrinsic: number, price: number): number | null {
  if (intrinsic <= 0 || price <= 0) return null;
  return Math.round(((intrinsic - price) / intrinsic) * 1000) / 10;
}

export const MOS_EXTREME_THRESHOLD = 50;

export function isMosExtreme(mos: number | null): boolean {
  return mos !== null && Math.abs(mos) > MOS_EXTREME_THRESHOLD;
}

export function mosZone(mos: number | null): string {
  if (mos === null) return 'Unknown';
  if (mos > 40) return 'Strong Buy';
  if (mos >= 25) return 'Buy';
  if (mos >= 10) return 'Accumulate';
  if (mos >= 0) return 'Hold';
  return 'Expensive';
}

export function finalRating(mos: number | null): { label: string; tier: string } {
  const zone = mosZone(mos);
  const tier =
    zone === 'Strong Buy' ? 'strong_buy' : zone === 'Buy' ? 'buy' : zone === 'Accumulate' ? 'accumulate' : zone === 'Hold' ? 'hold' : 'avoid';
  return { label: zone, tier };
}

export function qualityScore(stock: Partial<StockMetrics>): number {
  let score = 0;
  const roe = Number(stock.roe ?? 0);
  const roce = Number(stock.roce ?? 0);
  if (roe >= 20) score += 25;
  else if (roe >= 15) score += 18;
  else if (roe >= 12) score += 10;
  if (roce >= 18) score += 20;
  else if (roce >= 12) score += 12;
  const growth = resolveGrowthContext(stock);
  if (growth.revenue_growth >= 15) score += 20;
  else if (growth.revenue_growth >= 8) score += 12;
  const de = Number(stock.debt_to_equity ?? 0);
  if (de <= 0.3) score += 15;
  else if (de <= 0.8) score += 8;
  const pe = Number(stock.pe ?? 0);
  if (pe > 0 && pe <= 25) score += 10;
  else if (pe > 0 && pe <= 35) score += 5;
  return Math.min(100, score);
}

export function analyzeValuation(stock: Partial<StockMetrics>) {
  const price = Number(stock.price ?? stock.current_price ?? 0);
  let pe = Number(stock.pe ?? stock.pe_ratio ?? 0);
  let eps = Number(stock.eps ?? 0);
  if (eps <= 0 && pe > 0 && price > 0) eps = price / pe;

  const growth = resolveGrowthContext(stock);
  const bookValue = resolveBookValue(Number(stock.book_value ?? 0), eps, Number(stock.roe ?? 0));
  const sectorKey = normalizeSector(String(stock.sector ?? 'general'));

  if (price <= 0 || (eps <= 0 && pe <= 0)) {
    return {
      intrinsic: 0,
      mos: null as number | null,
      zone: 'Unknown',
      action: 'Run full verify for MOS',
      fair_pe: 0,
      method: 'none',
      graham: 0,
      quality_score: 0,
      final_rating: 'Unknown',
      sector_key: sectorKey,
    };
  }

  const fairPe = calculateFairPe(growth.eps_growth, {
    sector: stock.sector,
    roe: Number(stock.roe ?? 0),
    roce: Number(stock.roce ?? 0),
    revenue_growth: growth.revenue_growth,
  });

  let intrinsic = 0;
  let method = 'dcf_fairpe_ddm';
  const roe = Number(stock.roe ?? 0);

  if (sectorKey === 'banking' || sectorKey === 'nbfc') {
    const fairPb = roe >= 15 ? 2.5 : 1.8;
    intrinsic = bookValue > 0 ? Math.round(bookValue * fairPb * 100) / 100 : 0;
    method = 'pb';
  } else if (eps > 0 && fairPe.fair_pe > 0) {
    intrinsic = Math.round(eps * fairPe.fair_pe * 100) / 100;
  }

  const graham = grahamNumber(eps, bookValue);
  const mos = mosFromIntrinsic(intrinsic, price);
  const rating = finalRating(mos);
  const qScore = qualityScore(stock);

  return {
    intrinsic,
    mos,
    zone: rating.label,
    action: rating.label,
    fair_pe: fairPe.fair_pe,
    method,
    graham,
    quality_score: qScore,
    final_rating: rating.label,
    sector_key: sectorKey,
    fair_pe_detail: fairPe,
    normalized_eps: eps,
    book_value: bookValue,
    price,
  };
}

export function matrixVerdict(score: number, mos: number): string {
  const scoreBand =
    score >= 45 ? 'high' : score >= 35 ? 'mid' : score >= 25 ? 'low' : 'reject';
  const mosBand = mos >= 20 ? 'deep' : mos >= 10 ? 'buy' : mos >= 0 ? 'fair' : 'expensive';
  const matrix: Record<string, Record<string, string>> = {
    high: { deep: 'Strong Buy', buy: 'Buy / SIP', fair: 'Hold / small add', expensive: 'Wait' },
    mid: { deep: 'Buy staggered', buy: 'Watchlist', fair: 'Hold only', expensive: 'Avoid new' },
    low: { deep: 'Watchlist', buy: 'Avoid', fair: 'Avoid', expensive: 'Reject' },
    reject: { deep: 'Reject', buy: 'Reject', fair: 'Reject', expensive: 'Reject' },
  };
  return matrix[scoreBand][mosBand];
}

export function analyzeSymbol(stock: Partial<StockMetrics>) {
  const valuation = analyzeValuation(stock);
  const composite = valuation.quality_score;
  const verifyScore = Math.round(Math.max(0, Math.min(56, composite * 56 / 100)));
  const mos = valuation.mos ?? 0;
  const recommendation = matrixVerdict(verifyScore, mos);

  return {
    ...valuation,
    composite_score: composite,
    verify_score: verifyScore,
    recommendation,
    passed: verifyScore >= 25 && mos >= -5,
  };
}
