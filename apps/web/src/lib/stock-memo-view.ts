import type { StockMemoHeroProps } from '../components/research/StockMemoLayout';
import { buildScreeningThesis, gradeFromVerdict } from '../components/research/StockMemoLayout';

export interface StockSummaryMemoInput {
  symbol: string;
  name: string;
  metrics: Record<string, unknown>;
  valuation: {
    intrinsic: number;
    mos: number | null;
    zone: string;
    fair_pe: number;
    quality_score: number;
    recommendation: string;
    final_rating: string;
    graham: number;
    method: string;
    verify_score: number;
    score_basis?: 'quality_proxy' | 'full_scorecard';
    recommendation_basis?: 'screening_matrix' | 'full_verify_matrix';
    moat_tier?: string;
  };
  last_verify?: {
    mode: string;
    recommendation: string;
    recommendation_basis?: string;
    score_basis?: string;
    memo?: {
      headline?: string;
      strengths?: string[];
      risks?: string[];
      investment_case?: string;
    } | null;
  } | null;
  sources?: string[];
  from_cache?: boolean;
  data_quality?: {
    level: 'reported' | 'limited' | 'estimated';
  };
}

export interface StockMemoMetricTile {
  label: string;
  value: string;
}

export interface StockMemoView {
  hero: StockMemoHeroProps;
  pillars: Record<string, string>;
  investmentCase: string;
  strengths: string[];
  risks: string[];
  metricTiles: StockMemoMetricTile[];
  compareRows: Array<{ label: string; value: string }>;
}

function fmtMoney(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function fmtNum(v: unknown, suffix = ''): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return '—';
  return `${n}${suffix}`;
}

export function verdictClass(rec: string): string {
  const r = rec.toLowerCase();
  if (r.includes('strong') || r.includes('buy')) return 'badge badge-buy';
  if (r.includes('hold') || r.includes('accumulate')) return 'badge badge-hold';
  return 'badge badge-expensive';
}

/** Build memo layout props from stock summary (+ optional TA for screening thesis). */
export function buildStockMemoView(
  summary: StockSummaryMemoInput,
  ta: Record<string, unknown> = {},
): StockMemoView {
  const v = summary.valuation;
  const m = summary.metrics;
  const lv = summary.last_verify;
  const useFull = lv?.mode === 'full' && lv.recommendation;
  const verdict = useFull ? lv!.recommendation : v.final_rating;

  const screeningThesis = buildScreeningThesis({
    recommendation: verdict,
    zone: v.zone,
    mos: v.mos,
    roe: Number(m.roe),
    roce: Number(m.roce),
    pe: Number(m.pe),
    moatTier: v.moat_tier,
    taCrossEma20: ta.ta_cross_above_ema20 === true,
    taPct52w: typeof ta.ta_pct_52w === 'number' ? ta.ta_pct_52w : null,
  });

  const memoStrengths = lv?.memo?.strengths?.length ? lv.memo.strengths : screeningThesis.strengths;
  const memoRisks = lv?.memo?.risks?.length ? lv.memo.risks : screeningThesis.risks;
  const headline =
    lv?.memo?.headline ||
    `${fmtMoney(m.price)} · MOS ${v.mos !== null ? `${v.mos}%` : '—'} · ${v.zone}`;

  const hero: StockMemoHeroProps = {
    symbol: summary.symbol,
    name: summary.name,
    verdict,
    verdictClassName: verdictClass(verdict),
    grade: gradeFromVerdict(verdict),
    headline: lv?.memo?.headline ? headline : undefined,
    subline: lv?.memo?.headline ? undefined : headline,
    qualityScore: v.quality_score,
    verifyScore: v.verify_score,
    scoreLabel: useFull || lv?.score_basis === 'full_scorecard' ? 'scorecard' : 'proxy',
    recommendationBasis: useFull ? 'full_verify_matrix' : v.recommendation_basis,
    scoreBasis: useFull ? 'full_scorecard' : v.score_basis,
    dataQuality: summary.data_quality?.level,
    sources: summary.sources,
    fromCache: summary.from_cache,
  };

  const metricTiles: StockMemoMetricTile[] = [
    { label: 'Intrinsic', value: fmtMoney(v.intrinsic) },
    { label: 'Fair P/E', value: `${v.fair_pe}×` },
    { label: 'Graham', value: fmtMoney(v.graham) },
    { label: 'Method', value: v.method || '—' },
  ];

  const compareRows: Array<{ label: string; value: string }> = [
    { label: 'Verdict', value: verdict },
    { label: 'Quality /100', value: String(v.quality_score) },
    { label: 'Verify score', value: `${v.verify_score}/56` },
    { label: 'MOS', value: v.mos != null ? `${v.mos}%` : '—' },
    { label: 'Zone', value: v.zone },
    { label: 'P/E', value: fmtNum(m.pe) },
    { label: 'ROE', value: fmtNum(m.roe, '%') },
    { label: 'ROCE', value: fmtNum(m.roce, '%') },
    { label: 'Price', value: fmtMoney(m.price) },
    { label: 'Intrinsic', value: fmtMoney(v.intrinsic) },
    { label: 'Fair P/E', value: `${v.fair_pe}×` },
    { label: 'Moat', value: v.moat_tier ?? '—' },
  ];

  return {
    hero,
    pillars: screeningThesis.pillars,
    investmentCase: lv?.memo?.investment_case ?? screeningThesis.investmentCase,
    strengths: memoStrengths,
    risks: memoRisks,
    metricTiles,
    compareRows,
  };
}

export function normalizeSymbolInput(value: string): string {
  return value.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
}
