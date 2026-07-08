import { altmanUsableForScoring, altmanZone } from './quant-screen-helper.js';
import type { PhaseResult, VerificationResult, VerifyInput } from './verification/types.js';

export interface InvestmentMemoValuation {
  current: number;
  intrinsic: number;
  mos_pct: number | null;
  zone: string;
  pe: number;
  fair_pe: number;
  fair_pe_rationale: string;
  peg: number;
  fcf_yield: number;
  dcf_value: number;
  alt_value: number;
  alt_label: string;
  model: string;
  sector: string;
  fcf_source: string;
  ebitda_source: string;
  valuation_flags: string[];
}

export interface InvestmentMemo {
  grade: string;
  rating: string;
  verdict: string;
  verdict_color: string;
  conviction: string;
  headline: string;
  pillars: Record<string, string>;
  strengths: string[];
  risks: string[];
  next_steps: string[];
  investment_case: string;
  valuation: InvestmentMemoValuation;
  quality: {
    score: number;
    breakdown: Record<string, number>;
    roe: number;
    roce: number;
    de: number;
    piotroski: number;
    altman_z: number;
    altman_zone: string;
    altman_skip: boolean;
    z_score_source: string;
    graham_number: number;
    graham_credible: boolean;
    graham_label: string;
    moat: string;
  };
  score: number;
  score_max: number;
  score_pct: number;
  gates_passed: number;
  gates_total: number;
  position: VerificationResult['position_size'];
  thesis: {
    business: string;
    financials: string;
    valuation: string;
  };
  invalidations: string[];
}

const PILLAR_MAX: Record<string, string> = {
  ROE: '20',
  ROCE: '20',
  Debt: '15',
  'F-Score': '15',
  Moat: '15',
  Management: '10',
  'Cash Flow': '5',
  Distress: '5',
};

function gatePassRate(phases: PhaseResult[]): { passed: number; total: number } {
  let passed = 0;
  let total = 0;
  for (const phase of phases) {
    for (const gate of phase.gates) {
      total++;
      if (gate.status === 'pass') passed++;
    }
  }
  return { passed, total };
}

function cfaGrade(score: number, max: number, mos: number | null, rating: string): string {
  const pct = max > 0 ? (score / max) * 100 : 0;
  if (mos === null) return pct >= 60 ? 'C' : 'D';
  if (rating.includes('Expensive') || rating.includes('REJECT') || rating.includes('EXIT')) {
    return mos < 0 ? 'D' : 'C';
  }
  if (pct >= 75 && mos >= 25) return 'A';
  if (pct >= 60 && mos >= 10) return 'B';
  if (pct >= 45) return 'C';
  return 'D';
}

function qualityPillars(breakdown: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(breakdown)) {
    out[k] = `${v}/${PILLAR_MAX[k] ?? '?'}`;
  }
  return out;
}

function ratingLabel(grade: string): string {
  switch (grade) {
    case 'A':
      return 'Strong Buy Candidate';
    case 'B':
      return 'Accumulate / Research';
    case 'C':
      return 'Watchlist Only';
    case 'D':
      return 'Avoid New Entry';
    default:
      return 'Reject';
  }
}

function investmentCase(
  result: VerificationResult,
  industry: string,
  grade: string,
  roe: number,
  roce: number,
): string {
  const name = result.stock_name || 'This company';
  const mos = result.metrics.margin_of_safety;
  const pe = result.metrics.pe ?? 0;

  let p1 = name;
  if (industry) p1 += ` operates in ${industry}`;
  p1 += '. ';
  if (grade === 'A' || grade === 'B') {
    p1 += `Fundamentals screen well for a quality compounder: ROE ${roe}%, ROCE ${roce}%. `;
  } else if (grade === 'C') {
    p1 += 'Mixed quality — selective exposure only after confirming moat and management. ';
  } else {
    p1 += 'Does not meet minimum quality thresholds for new capital allocation. ';
  }

  const p2 =
    mos === null
      ? 'Valuation is incomplete because intrinsic value or price inputs are unavailable — refresh fundamentals before acting.'
      : mos >= 15
        ? `Valuation offers a margin of safety of ${mos}% versus intrinsic estimate — attractive for patient capital.`
        : mos >= 0
          ? `Trading near fair value (MOS ${mos}%) — stagger entries or wait for pullback.`
          : 'Price appears ahead of intrinsic value — patience or pass recommended.';

  let p3 = pe > 0 ? ` At P/E ${pe}, ` : ' ';
  p3 +=
    grade === 'A' || grade === 'B'
      ? 'confirm thesis with annual report, management commentary, and sector outlook before sizing.'
      : grade === 'C'
        ? 'add to watchlist; re-run after next quarterly results.'
        : 'capital is better deployed elsewhere in the universe.';

  return `${p1} ${p2} ${p3}`.trim();
}

export function buildInvestmentMemo(
  result: VerificationResult,
  fetchData: {
    current_price?: number;
    industry?: string;
    sector?: string;
    roe?: number;
    roce?: number;
  },
  input: VerifyInput = {},
): InvestmentMemo {
  const m = result.metrics;
  const v = result.verdict;
  const sc = result.scorecard;
  const exec = result.executive_summary;

  let conviction = exec.conviction ?? 'None';
  const altZ = m.altman_z ?? 0;
  if (
    altZ > 0 &&
    !input.altman_skip &&
    !m.altman_skip &&
    altmanUsableForScoring(String(m.z_score_source ?? 'missing'))
  ) {
    const zone = m.altman_zone ?? altmanZone(altZ);
    if (zone === 'grey' && conviction === 'High') conviction = 'Medium';
    else if (zone === 'grey' && conviction === 'Medium') conviction = 'Low';
  }

  const price = Number(fetchData.current_price ?? input.current_price ?? 0);
  const intrinsic = Number(m.intrinsic_value ?? 0);
  const mos = m.margin_of_safety;
  const qualityScore = Number(m.quality_score ?? 0);
  const score = qualityScore > 0 ? qualityScore : sc.total;
  const max = qualityScore > 0 ? 100 : sc.max;
  const finalRating = String(m.final_rating ?? '');
  const grade = cfaGrade(score, max, mos, finalRating);
  const passRate = gatePassRate(result.phases);
  const breakdown =
    m.quality_breakdown && typeof m.quality_breakdown === 'object'
      ? m.quality_breakdown
      : {};

  return {
    grade,
    rating: finalRating !== '' ? finalRating : ratingLabel(grade),
    verdict: finalRating !== '' ? finalRating : v.action,
    verdict_color: v.color,
    conviction,
    headline: String(m.business_summary ?? exec.headline ?? ''),
    pillars: qualityPillars(breakdown),
    strengths: exec.strengths ?? [],
    risks: (m.key_risks?.length ? m.key_risks : exec.risks) ?? [],
    next_steps: exec.next_steps ?? [],
    investment_case: investmentCase(
      result,
      String(fetchData.industry ?? fetchData.sector ?? ''),
      grade,
      Number(fetchData.roe ?? 0),
      Number(fetchData.roce ?? 0),
    ),
    valuation: {
      current: price,
      intrinsic,
      mos_pct: mos,
      zone: String(m.mos_zone ?? v.mos_zone ?? ''),
      pe: Number(m.pe ?? 0),
      fair_pe: Number(m.fair_pe ?? 0),
      fair_pe_rationale: String(
        (m.fair_pe_detail as { rationale?: string } | undefined)?.rationale ?? '',
      ),
      peg: Number(m.peg ?? 0),
      fcf_yield: Number(m.fcf_yield ?? 0),
      dcf_value: Number(m.dcf_value ?? 0),
      alt_value: Number(m.alt_value ?? 0),
      alt_label: String(m.alt_label ?? ''),
      model: String(m.valuation_model ?? m.mos_method ?? ''),
      sector: String(m.sector_label ?? fetchData.sector ?? ''),
      fcf_source: String(m.fcf_source ?? ''),
      ebitda_source: String(m.ebitda_source ?? ''),
      valuation_flags: m.valuation_flags ?? [],
    },
    quality: {
      score: qualityScore,
      breakdown,
      roe: Number(fetchData.roe ?? 0),
      roce: Number(fetchData.roce ?? 0),
      de: Number(m.de ?? 0),
      piotroski: Number(m.piotroski ?? -1),
      altman_z: altZ,
      altman_zone: String(m.altman_zone ?? 'unknown'),
      altman_skip: Boolean(input.altman_skip),
      z_score_source: String(m.z_score_source ?? 'missing'),
      graham_number: Number(m.graham_number ?? 0),
      graham_credible: Boolean(m.graham_credible),
      graham_label: String(m.graham_label ?? ''),
      moat: String(m.moat_strength ?? ''),
    },
    score,
    score_max: max,
    score_pct: max > 0 ? Math.round((score / max) * 100) : 0,
    gates_passed: passRate.passed,
    gates_total: passRate.total,
    position: result.position_size,
    thesis: {
      business: String(input.thesis_business ?? ''),
      financials: String(input.thesis_financials ?? ''),
      valuation: String(input.thesis_valuation ?? ''),
    },
    invalidations: [input.invalidation_1, input.invalidation_2].filter(
      (x): x is string => Boolean(x),
    ),
  };
}
