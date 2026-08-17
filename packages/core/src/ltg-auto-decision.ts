/** CFA LTG auto decision layer — PHP FundamentalAutoDecision parity (simplified for screener rows). */

export type LtgRecommendationTier =
  | 'strong_buy'
  | 'buy'
  | 'buy_staggered'
  | 'hold'
  | 'watchlist'
  | 'avoid'
  | 'research';

export type LtgDecisionAction = 'CORE_LTG' | 'ACCUMULATE' | 'WATCH_LT' | 'SKIP';

export interface LtgRowInput {
  symbol?: string;
  recommendation?: string;
  composite_score?: number;
  verify_score?: number;
  mos?: number | null;
  moat_tier?: string;
  roce?: number;
  roe?: number;
  sales_yoy?: number;
  profit_yoy?: number;
  pe?: number;
  peg?: number;
  debt_to_equity?: number;
  zone?: string;
  grade?: string;
}

export interface EnrichedLtgRow extends LtgRowInput {
  recommendation_tier: LtgRecommendationTier;
  decision_score: number;
  decision_action: LtgDecisionAction;
  decision_label: string;
  high_conviction: boolean;
  ltg_rank: number;
  risk_flags: string[];
}

const VERDICT_TO_TIER: Record<string, LtgRecommendationTier> = {
  'Strong Buy': 'strong_buy',
  'Buy / SIP': 'buy',
  'Buy staggered': 'buy_staggered',
  'Hold / small add': 'hold',
  'Hold only': 'hold',
  Watchlist: 'watchlist',
  Wait: 'watchlist',
  'Avoid new': 'avoid',
  Avoid: 'avoid',
  Reject: 'avoid',
  'Need Data': 'research',
};

const ACTION_LABELS: Record<LtgDecisionAction, string> = {
  CORE_LTG: 'Core LTG',
  ACCUMULATE: 'Accumulate',
  WATCH_LT: 'Watch (LT)',
  SKIP: 'Skip',
};

export function recommendationTierFromVerdict(recommendation: string): LtgRecommendationTier {
  return VERDICT_TO_TIER[recommendation] ?? 'research';
}

export function passesRecommendationTiers(
  recommendation: string,
  allowed: LtgRecommendationTier[],
): boolean {
  if (!allowed.length) return true;
  return allowed.includes(recommendationTierFromVerdict(recommendation));
}

function rowScore(row: LtgRowInput): number {
  if (typeof row.verify_score === 'number') return row.verify_score;
  if (typeof row.composite_score === 'number') return row.composite_score;
  return 0;
}

function isGradeA(row: LtgRowInput): boolean {
  if (row.grade === 'A') return true;
  return rowScore(row) >= 75;
}

export function ltgRiskFlags(row: LtgRowInput): string[] {
  const flags: string[] = [];
  const pe = row.pe ?? 0;
  if (pe > 40) flags.push('HIGH_PE');
  const mos = row.mos;
  if (mos != null && mos < 0) flags.push('ABOVE_IV');
  if ((row.moat_tier ?? '') !== 'strong') flags.push('MOAT_NOT_STRONG');
  const peg = row.peg;
  if (peg != null && peg > 2.5) flags.push('PEG_STRETCHED');
  const sales = row.sales_yoy;
  if (sales != null && sales < 5) flags.push('SLOW_GROWTH');
  const roce = row.roce ?? 0;
  const roe = row.roe ?? 0;
  const de = row.debt_to_equity ?? 0;
  if (roe - roce > 8 && de > 1) flags.push('LEVERAGE_TRAP');
  return flags;
}

export function ltgDecisionScore(row: LtgRowInput, flags: string[]): number {
  let score = Math.round(rowScore(row) * 0.5);
  const tier = recommendationTierFromVerdict(String(row.recommendation ?? ''));
  if (tier === 'strong_buy') score += 22;
  else if (tier === 'buy') score += 16;
  else if (tier === 'buy_staggered') score += 10;

  if (isGradeA(row)) score += 12;
  else if (row.grade === 'B' || (rowScore(row) >= 65 && rowScore(row) < 75)) score += 6;

  const mos = row.mos;
  if (mos != null) {
    if (mos >= 20) score += 10;
    else if (mos >= 10) score += 6;
    else if (mos >= 5) score += 3;
  }

  const sales = row.sales_yoy;
  if (sales != null) {
    if (sales >= 15) score += 8;
    else if (sales >= 8) score += 5;
    else if (sales >= 5) score += 2;
  }

  const penalties: Record<string, number> = {
    HIGH_PE: 8,
    ABOVE_IV: 12,
    MOAT_NOT_STRONG: 12,
    PEG_STRETCHED: 10,
    LEVERAGE_TRAP: 8,
    SLOW_GROWTH: 6,
  };
  for (const flag of flags) score -= penalties[flag] ?? 4;

  return Math.max(0, Math.min(100, score));
}

export function ltgEntryAction(row: LtgRowInput, score: number, flags: string[]): LtgDecisionAction {
  if (flags.includes('LEVERAGE_TRAP') && score < 70) return 'SKIP';

  const tier = recommendationTierFromVerdict(String(row.recommendation ?? ''));
  let action: LtgDecisionAction = 'SKIP';
  if (score >= 80 && tier === 'strong_buy' && isGradeA(row)) action = 'CORE_LTG';
  else if (score >= 68 && (tier === 'strong_buy' || tier === 'buy')) action = 'ACCUMULATE';
  else if (score >= 55 && (tier === 'buy' || tier === 'buy_staggered')) action = 'WATCH_LT';

  if (action === 'CORE_LTG' && flags.includes('ABOVE_IV')) action = 'ACCUMULATE';
  return action;
}

export function ltgIsHighConviction(
  row: LtgRowInput,
  score: number,
  action: LtgDecisionAction,
  flags: string[],
): boolean {
  if (action === 'SKIP') return false;
  if (action !== 'CORE_LTG' && score < 78) return false;
  if (flags.includes('ABOVE_IV') || flags.includes('MOAT_NOT_STRONG')) return false;
  const peg = row.peg;
  if (peg != null && peg > 2.5) return false;
  const mos = row.mos;
  if (mos == null || mos < 8) return false;
  const sales = row.sales_yoy;
  const tier = recommendationTierFromVerdict(String(row.recommendation ?? ''));
  return (
    sales != null &&
    sales >= 8 &&
    rowScore(row) >= 75 &&
    (tier === 'strong_buy' || tier === 'buy')
  );
}

export function ltgRank(decisionScore: number, row: LtgRowInput): number {
  const sc = rowScore(row);
  const mos = row.mos != null ? Math.max(0, Math.min(99, Math.round(row.mos))) : 0;
  const moat = row.moat_tier === 'strong' ? 5 : 0;
  return decisionScore * 10000 + sc * 100 + mos + moat;
}

export function enrichLtgRow(row: LtgRowInput): EnrichedLtgRow {
  const flags = ltgRiskFlags(row);
  const decision_score = ltgDecisionScore(row, flags);
  const decision_action = ltgEntryAction(row, decision_score, flags);
  const high_conviction = ltgIsHighConviction(row, decision_score, decision_action, flags);
  return {
    ...row,
    recommendation_tier: recommendationTierFromVerdict(String(row.recommendation ?? '')),
    decision_score,
    decision_action,
    decision_label: ACTION_LABELS[decision_action],
    high_conviction,
    ltg_rank: ltgRank(decision_score, row),
    risk_flags: flags,
  };
}

export interface LtgGuidance {
  tone: 'neutral' | 'warning' | 'success';
  title: string;
  message: string;
  deploy_pct: number;
}

export function ltgGuidanceFromSummary(summary: {
  passed: number;
  scanned: number;
  high_conviction: number;
  strict_enter: number;
}): LtgGuidance {
  const { passed, scanned, high_conviction, strict_enter } = summary;
  const core = strict_enter;

  if (high_conviction === 0 && core === 0) {
    if (passed > 0) {
      return {
        tone: 'warning',
        title: `${passed} passed screen — none in core/high conviction yet`,
        message:
          'Preset is elite (strong moat · ROCE ≥ 18% · sales ≥ 8% · score ≥ 65). Review setup radar; run Full Verify before sizing.',
        deploy_pct: Math.min(40, Math.max(10, passed * 5)),
      };
    }
    return {
      tone: 'warning',
      title: 'No LTG core names this scan',
      message: `Scanned ${scanned} symbols — none passed buy-eligible gates. Try Quality Compounders preset, then Verify finalists.`,
      deploy_pct: 0,
    };
  }

  if (high_conviction === 0) {
    return {
      tone: 'warning',
      title: 'Accumulate tier only — no high conviction',
      message: `${core} core/accumulate candidates; none cleared high-conviction (MOS ≥ 8% · strong moat · sales ≥ 8%). Stagger entries; cap single-name at 3–5% NAV.`,
      deploy_pct: Math.min(60, Math.max(20, core * 8)),
    };
  }

  return {
    tone: 'success',
    title: `${high_conviction} high-conviction LTG · ${core} strict enter`,
    message: `${passed} passed screen of ${scanned} scanned. Favor high conviction for core sleeve (5–8% NAV); strict enter for staggered adds. Run Full Verify before full sizing.`,
    deploy_pct: Math.min(100, 40 + high_conviction * 12),
  };
}
