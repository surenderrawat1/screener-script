import type { ExecutiveSummary, VerificationResult } from './verification/types.js';

function pillarLabel(score: number, max: number): string {
  const pct = (score / max) * 100;
  if (pct >= 75) return 'Strong';
  if (pct >= 50) return 'Adequate';
  if (pct >= 25) return 'Weak';
  return 'Poor';
}

function mosPillar(mos: number | null): string {
  if (mos === null) return 'Unknown';
  if (mos >= 25) return 'Deep value';
  if (mos >= 15) return 'Buy zone';
  if (mos >= 0) return 'Fair';
  return 'Expensive';
}

function headline(action: string, score: number, mos: number | null): string {
  if (mos === null) {
    return `Analysis incomplete — score ${score}/56 but MOS is unavailable. Refresh fundamentals before acting.`;
  }
  if (action.includes('STRONG BUY')) {
    return `High-conviction candidate — score ${score}/56 with ${Math.round(mos * 10) / 10}% MOS.`;
  }
  if (action.includes('BUY')) {
    return `Investable with discipline — score ${score}/56; confirm thesis before sizing.`;
  }
  if (action.includes('WAIT')) {
    return 'Quality business but valuation stretched — patience required.';
  }
  if (action.includes('REJECT') || action.includes('EXIT')) {
    return 'Does not meet minimum quality or risk thresholds.';
  }
  if (action.includes('FIX PERSONAL')) {
    return 'Complete investor foundation (Phase 0) before stock allocation.';
  }
  return `Analysis complete — score ${score}/56; review gate failures before acting.`;
}

function qualityPillars(
  m: VerificationResult['metrics'],
  phases: VerificationResult['phases'],
): Record<string, string> {
  const phaseScore = (n: number) => phases[n]?.score ?? 0;
  const phaseMax = (n: number) => Math.max(1, phases[n]?.max ?? 1);

  return {
    Business: pillarLabel(phaseScore(1), phaseMax(1)),
    Financials: pillarLabel(phaseScore(2), phaseMax(2)),
    Ratios: pillarLabel(phaseScore(3), phaseMax(3)),
    Valuation: pillarLabel(phaseScore(4), phaseMax(4)),
    Quant: pillarLabel(phaseScore(5), phaseMax(5)),
    [`MoS ${m.margin_of_safety === null ? 'Unknown' : `${Math.round(m.margin_of_safety)}%`}`]:
      mosPillar(m.margin_of_safety),
  };
}

function nextSteps(action: string, result: VerificationResult): string[] {
  const steps: string[] = [];

  if (result.investor_gate) {
    steps.push('Build 6-month emergency fund and clear high-interest debt (Phase 0).');
  }

  if (['STRONG BUY', 'BUY', 'STAGGERED BUY'].includes(action)) {
    steps.push('Read last 3 annual reports — verify auto-fetched numbers against AR/cash flow.');
    steps.push('Complete Phase 8 investment thesis (business, catalyst, exit trigger).');
    steps.push('Size position per portfolio rules — max 5–8% for high conviction.');
  } else if (['WATCHLIST', 'WAIT', 'HOLD'].includes(action)) {
    steps.push('Add to watchlist; set price alert at intrinsic −15% MOS.');
    steps.push('Re-run after next quarterly results.');
  } else {
    steps.push('Do not allocate capital — document reasons and move to next candidate.');
  }

  if (result.red_flag_scan.count > 0) {
    steps.push('Address each red flag with counter-evidence or reject the idea.');
  }

  return steps;
}

function conviction(score: number, mos: number | null, riskCount: number): string {
  if (mos === null) return score >= 35 ? 'Low' : 'None';
  if (score >= 45 && mos >= 15 && riskCount <= 1) return 'High';
  if (score >= 35 && mos >= 0 && riskCount <= 2) return 'Medium';
  if (score >= 25) return 'Low';
  return 'None';
}

export function buildExecutiveSummary(result: VerificationResult): ExecutiveSummary {
  const m = result.metrics;
  const v = result.verdict;
  const sc = result.scorecard;
  const rf = result.red_flag_scan;

  const score = sc.total;
  const mos = m.margin_of_safety;
  const action = v.action;

  const pillars = qualityPillars(m, result.phases);

  const strengths: string[] = [];
  if (m.moat_count >= 2) {
    strengths.push(`Economic moat signals present (${m.moat_strength})`);
  }
  if (mos !== null && mos >= 15) {
    strengths.push(`Margin of safety ${Math.round(mos * 10) / 10}% — price below intrinsic estimate`);
  }
  if (m.piotroski >= 7) {
    strengths.push(`Piotroski F-Score ${m.piotroski}/9 — strong financial quality`);
  }
  if (m.fcf_yield >= 3) {
    strengths.push(`FCF yield ${Math.round(m.fcf_yield * 10) / 10}% supports cash-return thesis`);
  }
  if (m.revenue_trend === 'growing') {
    strengths.push('Multi-year revenue trend is upward');
  }
  if (m.peg > 0 && m.peg <= 1.2) {
    strengths.push(`PEG ${m.peg} — growth at reasonable price`);
  }

  const risks = [...(rf.flags ?? []).slice(0, 5)];
  if (m.value_trap_count >= 2) {
    risks.push(`Value-trap checklist: ${m.value_trap_count}/5 warning signs`);
  }
  if (m.altman_z > 0 && m.altman_z < 2.99) {
    risks.push(`Altman Z-score ${m.altman_z} — distress zone risk`);
  }
  if (mos !== null && mos < 0) {
    risks.push('Trading above intrinsic value (negative MOS)');
  }
  for (const cf of result.critical_fails) {
    risks.push(`Critical: ${cf.label}`);
  }

  const uniqueRisks = [...new Set(risks)].slice(0, 6);

  return {
    headline: headline(action, score, mos),
    pillars,
    strengths: [...new Set(strengths)].slice(0, 5),
    risks: uniqueRisks,
    next_steps: nextSteps(action, result),
    conviction: conviction(score, mos, uniqueRisks.length),
  };
}
