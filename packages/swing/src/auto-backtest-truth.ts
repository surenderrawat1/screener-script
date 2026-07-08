/** Walk-forward backtest overlay for Swing Auto — parity with PHP SwingAutoBacktestTruth. */

export const DEFAULT_MAX_PRELOAD = 40;
export const MIN_TRADES_PROVEN = 5;
export const BT_TRUTH_TTL_SEC = 86400;

export const GRADE_STRONG = 'STRONG';
export const GRADE_OK = 'OK';
export const GRADE_WEAK = 'WEAK';
export const GRADE_FAIL = 'FAIL';
export const GRADE_UNPROVEN = 'UNPROVEN';

export interface WalkForwardStats {
  trades_closed: number;
  profit_factor: number;
  win_rate_pct: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  compounded_return_pct: number;
  max_drawdown_pct: number;
}

export interface BacktestTruthCompact extends WalkForwardStats {
  symbol: string;
  grade: string;
  grade_label: string;
  expectancy_pct: number;
  chart_range: string;
  chart_from: string;
  chart_to: string;
  cached_at: string;
  score_delta: number;
  risk_flag: string | null;
  method: 'walk_forward_2y';
}

export function normalizeGrade(grade: string): string {
  const g = grade.toUpperCase().trim();
  return [GRADE_STRONG, GRADE_OK, GRADE_WEAK, GRADE_FAIL, GRADE_UNPROVEN].includes(g) ? g : GRADE_UNPROVEN;
}

export function gradeLabel(grade: string): string {
  switch (normalizeGrade(grade)) {
    case GRADE_STRONG:
      return 'BT strong';
    case GRADE_OK:
      return 'BT ok';
    case GRADE_WEAK:
      return 'BT weak';
    case GRADE_FAIL:
      return 'BT fail';
    default:
      return 'BT unproven';
  }
}

export function gradeFromMetrics(metrics: { trades_closed?: number; profit_factor?: number; compounded_return_pct?: number }): string {
  const closed = Number(metrics.trades_closed ?? 0);
  if (closed < MIN_TRADES_PROVEN) return GRADE_UNPROVEN;

  const pf = Number(metrics.profit_factor ?? 0);
  const compound = Number(metrics.compounded_return_pct ?? 0);

  if (pf < 0.85 || compound < -8) return GRADE_FAIL;
  if (pf < 1.0 || compound < 0) return GRADE_WEAK;
  if (closed >= 8 && pf >= 1.25 && compound >= 5) return GRADE_STRONG;
  return GRADE_OK;
}

export function scoreDelta(grade: string): number {
  switch (normalizeGrade(grade)) {
    case GRADE_STRONG:
      return 10;
    case GRADE_OK:
      return 5;
    case GRADE_WEAK:
      return -10;
    case GRADE_FAIL:
      return -18;
    default:
      return -3;
  }
}

export function riskFlagForGrade(grade: string): string | null {
  switch (normalizeGrade(grade)) {
    case GRADE_STRONG:
      return 'BACKTEST_STRONG';
    case GRADE_OK:
      return null;
    case GRADE_WEAK:
      return 'BACKTEST_WEAK';
    case GRADE_FAIL:
      return 'BACKTEST_FAIL';
    default:
      return 'BACKTEST_UNPROVEN';
  }
}

/** Derive PHP-compatible stats from walk-forward signal outcomes (2y replay). */
export function statsFromWalkForwardSignals(
  signals: Array<{ forward_return_pct: number | null }>,
): WalkForwardStats {
  const closed = signals.filter((s) => s.forward_return_pct !== null);
  const wins: number[] = [];
  const losses: number[] = [];
  let grossWin = 0;
  let grossLoss = 0;
  let compound = 1;
  let equity = 100;
  let peak = 100;
  let maxDrawdown = 0;

  for (const s of closed) {
    const r = Number(s.forward_return_pct);
    if (r > 0) {
      wins.push(r);
      grossWin += r;
    } else if (r < 0) {
      losses.push(r);
      grossLoss += Math.abs(r);
    }
    compound *= 1 + r / 100;
    equity *= 1 + r / 100;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100);
  }

  const closedCount = closed.length;
  const winCount = wins.length;
  const lossCount = losses.length;
  const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99.99 : 0;

  return {
    trades_closed: closedCount,
    profit_factor: Math.round(pf * 100) / 100,
    win_rate_pct: closedCount > 0 ? Math.round((winCount / closedCount) * 1000) / 10 : 0,
    avg_win_pct: winCount > 0 ? Math.round((wins.reduce((a, b) => a + b, 0) / winCount) * 100) / 100 : 0,
    avg_loss_pct: lossCount > 0 ? Math.round((losses.reduce((a, b) => a + b, 0) / lossCount) * 100) / 100 : 0,
    compounded_return_pct: Math.round((compound - 1) * 10000) / 100,
    max_drawdown_pct: Math.round(maxDrawdown * 100) / 100,
  };
}

export function compactFromStats(stats: Partial<WalkForwardStats>, symbol = '', chartFrom = '', chartTo = ''): BacktestTruthCompact {
  const closed = Number(stats.trades_closed ?? 0);
  const pf = Number(stats.profit_factor ?? 0);
  const wr = Number(stats.win_rate_pct ?? 0);
  const avgWin = Number(stats.avg_win_pct ?? 0);
  const avgLoss = Number(stats.avg_loss_pct ?? 0);
  const compound = Number(stats.compounded_return_pct ?? 0);
  const expectancy = Math.round(((wr / 100) * avgWin + (1 - wr / 100) * avgLoss) * 100) / 100;

  const metrics = {
    trades_closed: closed,
    profit_factor: Math.round(pf * 100) / 100,
    win_rate_pct: Math.round(wr * 10) / 10,
    avg_win_pct: avgWin,
    avg_loss_pct: avgLoss,
    compounded_return_pct: Math.round(compound * 100) / 100,
    max_drawdown_pct: Math.round(Number(stats.max_drawdown_pct ?? 0) * 100) / 100,
  };

  const grade = gradeFromMetrics(metrics);

  return {
    symbol: symbol.toUpperCase(),
    grade,
    grade_label: gradeLabel(grade),
    expectancy_pct: expectancy,
    chart_range: '2y',
    chart_from: chartFrom,
    chart_to: chartTo,
    cached_at: new Date().toISOString(),
    score_delta: scoreDelta(grade),
    risk_flag: riskFlagForGrade(grade),
    method: 'walk_forward_2y',
    ...metrics,
  };
}

export function hitsForTruthPreload(hits: Record<string, unknown>[], max = DEFAULT_MAX_PRELOAD): string[] {
  const cap = Math.max(1, Math.min(80, max));
  const sorted = [...hits].sort(
    (a, b) =>
      Number(b.swing_rank ?? 0) - Number(a.swing_rank ?? 0) ||
      Number(b.entry_score ?? 0) - Number(a.entry_score ?? 0),
  );
  const symbols: string[] = [];
  for (const hit of sorted) {
    const sym = String(hit.symbol ?? '').toUpperCase();
    if (!sym || symbols.includes(sym)) continue;
    symbols.push(sym);
    if (symbols.length >= cap) break;
  }
  return symbols;
}

export function attachTruthToHits(
  hits: Record<string, unknown>[],
  truthMap: Record<string, BacktestTruthCompact>,
): Record<string, unknown>[] {
  return hits.map((hit) => {
    const sym = String(hit.symbol ?? '').toUpperCase();
    if (sym && truthMap[sym]) {
      return { ...hit, backtest_truth: truthMap[sym] };
    }
    return hit;
  });
}
