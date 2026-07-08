import { altmanUsableForScoring, altmanZone } from '../quant-screen-helper.js';
import type {
  CriticalFail,
  DerivedMetrics,
  PhaseResult,
  PositionSize,
  RedFlagScan,
  Scorecard,
  Verdict,
  VerifyInput,
} from './types.js';

export function mosZone(mos: number | null): string {
  if (mos === null) return 'Unknown';
  if (mos >= 25) return 'Deep value (≥25%)';
  if (mos >= 15) return 'Buy zone (15–25%)';
  if (mos >= 0) return 'Fair (0–15%)';
  return 'Expensive (<0%)';
}

export function buildScorecard(phases: PhaseResult[]): Scorecard {
  const rows = [];
  let total = 0;
  let maxTotal = 0;

  for (const phase of phases) {
    if (phase.number === 8) continue;
    rows.push({
      phase: phase.number,
      title: phase.title,
      score: phase.score,
      max: phase.max,
      critical_fail: phase.critical_fail,
    });
    total += phase.score;
    maxTotal += phase.max;
  }

  let grade: string;
  if (total >= 45) grade = 'A — Excellent';
  else if (total >= 35) grade = 'B — Good';
  else if (total >= 25) grade = 'C — Mixed';
  else if (total >= 15) grade = 'D — Weak';
  else grade = 'F — High Risk';

  return {
    rows,
    total,
    max: maxTotal,
    percent: maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0,
    grade,
  };
}

export function runRedFlagScan(
  input: VerifyInput,
  metrics: DerivedMetrics,
): RedFlagScan {
  const flags: string[] = [];

  const checks: [string, boolean][] = [
    ['Revenue falling 2+ years', metrics.revenue_trend === 'declining' || Boolean(input.vt_revenue_declining)],
    [
      'FCF negative while paying high dividend',
      metrics.fcf < 0 && Number(input.dividend_yield ?? 0) > 2,
    ],
    ['Promoter pledge > 25%', Number(input.p1_promoter_pledge ?? 0) > 25],
    [
      'Auditor qualified / frequent change',
      Boolean(input.rf_auditor_issue) || input.p1_auditor_clean === false,
    ],
    ['D/E > 1.5 + falling ROCE', metrics.de > 1.5 && Number(input.roce ?? 0) < 12],
    ['PEG > 2 with slowing growth', metrics.peg > 2 && Number(input.eps_growth ?? 0) < 10],
    ['CFO << PAT for 2+ years', input.p2_cfo_pat === false],
    [
      'Stock up 100%+ in 12 months with MOS < 0%',
      Boolean(input.rf_stock_up_100) &&
        metrics.margin_of_safety !== null &&
        metrics.margin_of_safety < 0,
    ],
    [
      'Cannot explain business model',
      input.p1_business_model === false || Boolean(input.rf_cannot_explain),
    ],
    ['Bought on tip / hype only', Boolean(input.rf_tip_buy)],
  ];

  if (
    !metrics.altman_skip &&
    (metrics.altman_z ?? 0) > 0 &&
    altmanUsableForScoring(String(metrics.z_score_source ?? 'missing')) &&
    altmanZone(metrics.altman_z) === 'distress'
  ) {
    flags.push(`Altman Z-score ${metrics.altman_z.toFixed(2)} — distress zone`);
  }

  if ((metrics.z_score_source ?? '') === 'unreliable') {
    flags.push('Altman Z-score proxy unreliable — verify from annual report');
  }

  for (const [label, active] of checks) {
    if (active) flags.push(label);
  }

  return {
    flags,
    count: flags.length,
    quick_reject: flags.length >= 2,
  };
}

export function verdictFromMatrix(
  score: number,
  mos: number | null,
  holding: boolean,
): [string, string, string] {
  if (mos === null) {
    return ['NEED DATA', 'neutral', 'Valuation is incomplete — refresh fundamentals or run Full Verify.'];
  }

  if (score >= 45) {
    if (mos >= 20) {
      return ['STRONG BUY', 'success', 'Score 45+ with MOS ≥ 20% — excellent quality at deep value.'];
    }
    if (mos >= 10) {
      return ['BUY', 'success', 'Score 45+ with MOS 10–20% — accumulate or SIP.'];
    }
    if (mos >= 0) {
      return [
        holding ? 'HOLD' : 'HOLD / SMALL ADD',
        'success',
        'Quality stock at fair price — hold or small additions only.',
      ];
    }
    return ['WAIT', 'warning', 'Quality passes but price ahead of value — wait for pullback.'];
  }

  if (score >= 35) {
    if (mos >= 20) {
      return ['STAGGERED BUY', 'success', 'Good score with margin of safety — buy in 2–3 tranches.'];
    }
    if (mos >= 10) {
      return ['WATCHLIST', 'warning', 'Good fundamentals — add on better price or after next results.'];
    }
    if (mos >= 0) {
      return ['HOLD ONLY', 'neutral', 'Hold existing; avoid new large positions.'];
    }
    return ['AVOID NEW', 'warning', 'Fair/good company but overpriced for new entry.'];
  }

  if (score >= 25) {
    if (mos >= 20) {
      return ['WATCHLIST', 'warning', 'Mixed quality — only if special situation with deep discount.'];
    }
    return ['AVOID', 'warning', 'Mixed signals — wait for better data or price.'];
  }

  return ['REJECT', 'danger', 'Weak score across phases — do not invest.'];
}

export function determineVerdict(
  input: VerifyInput,
  scorecard: Scorecard,
  metrics: DerivedMetrics,
  redFlagScan: RedFlagScan,
  criticalFails: CriticalFail[],
): Verdict {
  const score = scorecard.total;
  const mos = metrics.margin_of_safety;
  const holding = Boolean(input.already_holding);
  const hasCritical = criticalFails.length > 0;
  const quickReject = redFlagScan.quick_reject;

  let action: string;
  let color: string;
  let summary: string;

  if (hasCritical || quickReject || score < 15) {
    action = holding ? 'EXIT' : 'REJECT';
    color = 'danger';
    summary = hasCritical
      ? 'Critical gate failure — capital preservation priority.'
      : quickReject
        ? '2+ red flags without counter-thesis — stop here.'
        : 'Score too low for investment.';
  } else if (!input.p0_emergency_fund || !input.p0_debt_cleared) {
    action = 'FIX PERSONAL FINANCE FIRST';
    color = 'warning';
    summary = 'Complete Phase 0 (emergency fund + debt) before allocating to this stock.';
  } else {
    [action, color, summary] = verdictFromMatrix(score, mos, holding);
  }

  const thesisIncomplete = String(input.thesis_business ?? '').length < 20;
  if (
    !hasCritical &&
    thesisIncomplete &&
    ['BUY', 'STRONG BUY', 'STAGGERED BUY'].includes(action)
  ) {
    action = 'STAGGERED BUY';
    summary += ' Complete Phase 8 thesis before full position.';
  }

  return {
    action,
    color,
    summary,
    score,
    mos,
    grade: scorecard.grade,
    mos_zone: mosZone(mos),
  };
}

export function suggestPositionSize(
  verdict: Verdict,
  metrics: DerivedMetrics,
): PositionSize | null {
  const buyActions = ['STRONG BUY', 'BUY', 'STAGGERED BUY'];
  if (!buyActions.includes(verdict.action)) return null;

  const mos = metrics.margin_of_safety;
  if (mos === null) return null;
  if (mos >= 25) {
    return { conviction: 'High', mos: '≥25%', size: 'Up to 8–10% of portfolio' };
  }
  if (mos >= 15) {
    return { conviction: 'Medium', mos: '15–25%', size: '5–7% of portfolio' };
  }
  return { conviction: 'Low / first entry', mos: '10–15%', size: '2–3% — add later' };
}
