export const GRADE_A = 'A';
export const GRADE_B = 'B';
export const GRADE_C = 'C';
export const GRADE_F = 'F';

export function grade(analysis: Record<string, unknown>, plan: Record<string, unknown>, mtf?: Record<string, unknown> | null) {
  const bias = String(plan.bias ?? '');
  if (!['long', 'short'].includes(bias) || !plan.ok) {
    return pack(GRADE_F, 0, 0, [], ['No directional plan']);
  }
  const isLong = bias === 'long';
  const factors: string[] = [];
  const issues: string[] = [];
  let score = 0;

  const direction = String(analysis.direction ?? '');
  if (isLong && ['bullish', 'lean_bull'].includes(direction)) {
    score += direction === 'bullish' ? 18 : 10;
    factors.push(`Direction aligned (${direction})`);
  } else if (!isLong && ['bearish', 'lean_bear'].includes(direction)) {
    score += direction === 'bearish' ? 18 : 10;
    factors.push(`Direction aligned (${direction})`);
  } else {
    issues.push(`Direction conflicts with ${bias} bias`);
  }

  const net = Number(analysis.net_score ?? 0);
  const netMag = Math.abs(net);
  if (netMag >= 28) {
    score += 14;
    factors.push(`Strong net score (${net})`);
  } else if (netMag >= 18) {
    score += 8;
    factors.push(`Moderate net score (${net})`);
  } else {
    issues.push(`Weak net score (${net})`);
  }

  if (analysis.ema_stack_bull && isLong) {
    score += 14;
    factors.push('Bullish EMA-9 > EMA-21 stack');
  } else if (analysis.ema_stack_bear && !isLong) {
    score += 14;
    factors.push('Bearish EMA-9 < EMA-21 stack');
  }

  if (mtf?.ok && mtf.aligned) {
    score += 10;
    factors.push('MTF aligned');
  }

  const sq = analysis.setup_quality as Record<string, unknown> | undefined;
  if (sq?.grade === GRADE_A) score += 8;

  const confluence = factors.length;
  const gradeVal = scoreToGrade(score, confluence, issues.length);
  return pack(gradeVal, score, confluence, factors, issues);
}

export function gateReasons(
  analysis: Record<string, unknown>,
  plan: Record<string, unknown>,
  mtf: Record<string, unknown> | null | undefined,
  options: Record<string, unknown>,
): string[] {
  const reasons: string[] = [];
  const graded = grade(analysis, plan, mtf);
  const minGrade = String(options.min_setup_grade ?? '');
  if (minGrade && !gradeMeets(graded.grade, minGrade)) {
    reasons.push(`Setup grade ${graded.grade} below minimum ${minGrade} (score ${graded.score})`);
  }
  const minConfluence = Number(options.min_confluence ?? 0);
  if (minConfluence > 0 && graded.confluence < minConfluence) {
    reasons.push(`Confluence ${graded.confluence} below minimum ${minConfluence}`);
  }
  const minScore = Number(options.min_setup_score ?? 0);
  if (minScore > 0 && graded.score < minScore) {
    reasons.push(`Setup score ${graded.score} below minimum ${minScore}`);
  }
  if (options.require_ema_stack) {
    const bias = String(plan.bias ?? '');
    if (bias === 'long' && !analysis.ema_stack_bull) reasons.push('Long requires bullish EMA stack');
    if (bias === 'short' && !analysis.ema_stack_bear) reasons.push('Short requires bearish EMA stack');
  }
  const minNet = Number(options.min_net_score ?? 0);
  if (minNet > 0) {
    const net = Math.abs(Number(analysis.net_score ?? 0));
    if (net < minNet) reasons.push(`Net score |${analysis.net_score ?? 0}| below ${minNet}`);
  }
  return reasons;
}

export function gradeMeets(actual: string, minimum: string): boolean {
  const order: Record<string, number> = { F: 0, C: 1, B: 2, A: 3 };
  return (order[actual] ?? 0) >= (order[minimum] ?? 0);
}

function scoreToGrade(score: number, confluence: number, issueCount: number): string {
  if (score >= 72 && confluence >= 5 && issueCount <= 1) return GRADE_A;
  if (score >= 55 && confluence >= 4 && issueCount <= 2) return GRADE_B;
  if (score >= 38 && confluence >= 3) return GRADE_C;
  return GRADE_F;
}

function pack(grade: string, score: number, confluence: number, factors: string[], issues: string[]) {
  return { grade, score, confluence, factors, issues };
}
