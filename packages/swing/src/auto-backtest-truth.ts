/** Walk-forward backtest overlay for Swing Auto — economic-edge first. */

export const DEFAULT_MAX_PRELOAD = 50;
export const MIN_TRADES_PROVEN = 5;
export const MIN_TRADES_STRONG = 8;
export const BT_TRUTH_TTL_SEC = 86400;

/**
 * Soft win-rate observation only — never the primary optimization target.
 * Kept for diagnostics / soft risk flags.
 */
export const MIN_PROFITABLE_WIN_RATE_PCT = 70;
export const SOFT_WIN_RATE_FLOOR_PCT = 40;

/** Primary economic floors (Expectancy → CAGR → DD → PF). */
export const MIN_EXPECTANCY_PCT = 0.25;
export const MIN_EXPECTANCY_STRONG_PCT = 0.8;
export const MIN_PROFIT_FACTOR = 1.0;
export const MIN_PROFIT_FACTOR_STRONG = 1.25;
export const MIN_PROFIT_FACTOR_LIVE = 1.25;
export const MIN_COMPOUND_PCT = 0;
export const MIN_COMPOUND_STRONG_PCT = 5;
export const MAX_DRAWDOWN_OK_PCT = 25;
export const MAX_DRAWDOWN_STRONG_PCT = 15;
export const MAX_DRAWDOWN_FAIL_PCT = 35;
export const MAX_DRAWDOWN_LIVE_PCT = 20;

export const GRADE_STRONG = 'STRONG';
export const GRADE_OK = 'OK';
export const GRADE_WEAK = 'WEAK';
export const GRADE_FAIL = 'FAIL';
export const GRADE_UNPROVEN = 'UNPROVEN';

export type WinRateGateStatus = 'pass' | 'fail' | 'unproven' | 'missing';
export type EconomicEdgeStatus = 'pass' | 'fail' | 'unproven' | 'missing';

export interface WalkForwardStats {
  trades_closed: number;
  profit_factor: number;
  win_rate_pct: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  compounded_return_pct: number;
  max_drawdown_pct: number;
}

export interface EconomicEdgeMetrics {
  trades_closed?: number;
  profit_factor?: number;
  compounded_return_pct?: number;
  max_drawdown_pct?: number;
  expectancy_pct?: number;
  win_rate_pct?: number;
  avg_win_pct?: number;
  avg_loss_pct?: number;
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
  method: 'walk_forward_3y';
  win_rate_ok?: boolean;
  economic_edge_ok?: boolean;
  economic_edge_status?: EconomicEdgeStatus;
  /** Passive buy-and-hold over the same 3y evaluation window (for compounder sleeve routing). */
  buy_hold_pct?: number | null;
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

export function expectancyFromMetrics(metrics: EconomicEdgeMetrics): number {
  if (metrics.expectancy_pct != null && Number.isFinite(Number(metrics.expectancy_pct))) {
    return Math.round(Number(metrics.expectancy_pct) * 100) / 100;
  }
  const wr = Number(metrics.win_rate_pct ?? 0) / 100;
  const avgWin = Number(metrics.avg_win_pct ?? 0);
  const avgLoss = Number(metrics.avg_loss_pct ?? 0);
  return Math.round((wr * avgWin + (1 - wr) * avgLoss) * 100) / 100;
}

/**
 * Grade by economic edge priority:
 * 1) Expectancy  2) CAGR/compound  3) Max DD  4) Profit factor
 * Win rate is intentionally excluded from STRONG qualification.
 */
export function gradeFromMetrics(metrics: EconomicEdgeMetrics): string {
  const closed = Number(metrics.trades_closed ?? 0);
  if (closed < MIN_TRADES_PROVEN) return GRADE_UNPROVEN;

  const pf = Number(metrics.profit_factor ?? 0);
  const compound = Number(metrics.compounded_return_pct ?? 0);
  const dd = Number(metrics.max_drawdown_pct ?? 0);
  const expectancy = expectancyFromMetrics(metrics);

  if (pf < 0.85 || compound < -8 || dd > MAX_DRAWDOWN_FAIL_PCT) return GRADE_FAIL;
  if (expectancy <= 0 || pf < MIN_PROFIT_FACTOR || compound < MIN_COMPOUND_PCT || dd > MAX_DRAWDOWN_OK_PCT) {
    return GRADE_WEAK;
  }
  if (
    closed >= MIN_TRADES_STRONG &&
    expectancy >= MIN_EXPECTANCY_STRONG_PCT &&
    pf >= MIN_PROFIT_FACTOR_STRONG &&
    compound >= MIN_COMPOUND_STRONG_PCT &&
    dd <= MAX_DRAWDOWN_STRONG_PCT
  ) {
    return GRADE_STRONG;
  }
  return GRADE_OK;
}

/** Soft diagnostics only — not used as the primary live gate. */
export function meetsHighAccuracyWinRate(
  truth?: { trades_closed?: number; win_rate_pct?: number } | null,
): boolean {
  return winRateGateStatus(truth) === 'pass';
}

export function winRateGateStatus(
  truth?: { trades_closed?: number; win_rate_pct?: number } | null,
): WinRateGateStatus {
  if (!truth) return 'missing';
  const closed = Number(truth.trades_closed ?? 0);
  if (closed < MIN_TRADES_PROVEN) return 'unproven';
  const wr = Number(truth.win_rate_pct ?? 0);
  return wr >= MIN_PROFITABLE_WIN_RATE_PCT ? 'pass' : 'fail';
}

export function economicEdgeGateStatus(truth?: EconomicEdgeMetrics | null): EconomicEdgeStatus {
  if (!truth) return 'missing';
  const closed = Number(truth.trades_closed ?? 0);
  if (closed < MIN_TRADES_PROVEN) return 'unproven';

  const pf = Number(truth.profit_factor ?? 0);
  const compound = Number(truth.compounded_return_pct ?? 0);
  const dd = Number(truth.max_drawdown_pct ?? 0);
  const expectancy = expectancyFromMetrics(truth);

  if (
    expectancy > 0 &&
    pf >= MIN_PROFIT_FACTOR_LIVE &&
    compound >= MIN_COMPOUND_PCT &&
    dd <= MAX_DRAWDOWN_LIVE_PCT
  ) {
    return 'pass';
  }
  return 'fail';
}

export function meetsEconomicEdge(truth?: EconomicEdgeMetrics | null): boolean {
  return economicEdgeGateStatus(truth) === 'pass';
}

/** Human-readable block reasons for live/paper economic-edge enforcement. */
export function economicEdgeGateReasons(truth?: EconomicEdgeMetrics | null): string[] {
  const status = economicEdgeGateStatus(truth);
  if (status === 'missing') return ['BT evidence is missing'];
  if (status === 'unproven') return ['BT sample is unproven'];
  if (status === 'pass' || !truth) return [];

  const reasons: string[] = [];
  const expectancy = expectancyFromMetrics(truth);
  const pf = Number(truth.profit_factor ?? 0);
  const compound = Number(truth.compounded_return_pct ?? 0);
  const dd = Number(truth.max_drawdown_pct ?? 0);
  if (expectancy <= 0) reasons.push('BT expectancy is not positive');
  if (pf < MIN_PROFIT_FACTOR_LIVE) reasons.push(`BT profit factor below ${MIN_PROFIT_FACTOR_LIVE}`);
  if (compound < MIN_COMPOUND_PCT) reasons.push('BT compounded return is negative');
  if (dd > MAX_DRAWDOWN_LIVE_PCT) reasons.push(`BT max drawdown above ${MAX_DRAWDOWN_LIVE_PCT}%`);
  return reasons.length > 0 ? reasons : ['BT economic edge failed'];
}

export function scoreDelta(grade: string): number {
  switch (normalizeGrade(grade)) {
    case GRADE_STRONG:
      return 12;
    case GRADE_OK:
      return 6;
    case GRADE_WEAK:
      return -10;
    case GRADE_FAIL:
      return -18;
    default:
      return -3;
  }
}

/** Extra decision-score points from economic metrics (Expectancy first). */
export function economicScoreBoost(truth?: EconomicEdgeMetrics | null): number {
  if (!truth || Number(truth.trades_closed ?? 0) < MIN_TRADES_PROVEN) return 0;
  let boost = 0;
  const expectancy = expectancyFromMetrics(truth);
  const compound = Number(truth.compounded_return_pct ?? 0);
  const dd = Number(truth.max_drawdown_pct ?? 0);
  const pf = Number(truth.profit_factor ?? 0);

  if (expectancy >= MIN_EXPECTANCY_STRONG_PCT) boost += 8;
  else if (expectancy >= MIN_EXPECTANCY_PCT) boost += 4;
  else if (expectancy <= 0) boost -= 8;

  if (compound >= MIN_COMPOUND_STRONG_PCT) boost += 6;
  else if (compound >= MIN_COMPOUND_PCT) boost += 2;
  else if (compound < 0) boost -= 6;

  if (dd > 0 && dd <= MAX_DRAWDOWN_STRONG_PCT) boost += 4;
  else if (dd > MAX_DRAWDOWN_OK_PCT) boost -= 6;

  if (pf >= MIN_PROFIT_FACTOR_STRONG) boost += 4;
  else if (pf < MIN_PROFIT_FACTOR) boost -= 6;

  return boost;
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

export function riskFlagForWinRate(
  truth?: { trades_closed?: number; win_rate_pct?: number } | null,
): string | null {
  const status = winRateGateStatus(truth);
  if (status === 'fail') return 'BACKTEST_LOW_WR';
  if (status === 'pass') return 'BACKTEST_WR_OK';
  return null;
}

export function riskFlagForEconomicEdge(truth?: EconomicEdgeMetrics | null): string | null {
  const status = economicEdgeGateStatus(truth);
  if (status === 'fail') return 'BACKTEST_EDGE_FAIL';
  if (status === 'pass') return 'BACKTEST_EDGE_OK';
  if (status === 'unproven' || status === 'missing') return 'BACKTEST_UNPROVEN';
  return null;
}

/** Derive PHP-compatible stats from walk-forward signal outcomes (3y replay). */
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

export function compactFromStats(
  stats: Partial<WalkForwardStats>,
  symbol = '',
  chartFrom = '',
  chartTo = '',
  buyHoldPct: number | null = null,
): BacktestTruthCompact {
  const closed = Number(stats.trades_closed ?? 0);
  const pf = Number(stats.profit_factor ?? 0);
  const wr = Number(stats.win_rate_pct ?? 0);
  const avgWin = Number(stats.avg_win_pct ?? 0);
  const avgLoss = Number(stats.avg_loss_pct ?? 0);
  const compound = Number(stats.compounded_return_pct ?? 0);
  const maxDd = Math.round(Number(stats.max_drawdown_pct ?? 0) * 100) / 100;
  const expectancyPct =
    Math.round(((wr / 100) * avgWin + (1 - wr / 100) * avgLoss) * 100) / 100;

  const metrics = {
    trades_closed: closed,
    profit_factor: Math.round(pf * 100) / 100,
    win_rate_pct: Math.round(wr * 10) / 10,
    avg_win_pct: avgWin,
    avg_loss_pct: avgLoss,
    compounded_return_pct: Math.round(compound * 100) / 100,
    max_drawdown_pct: maxDd,
    expectancy_pct: expectancyPct,
  };

  const grade = gradeFromMetrics(metrics);
  const winRateOk = meetsHighAccuracyWinRate(metrics);
  const edgeStatus = economicEdgeGateStatus(metrics);

  return {
    ...metrics,
    symbol: symbol.toUpperCase(),
    grade,
    grade_label: gradeLabel(grade),
    chart_range: '3y',
    chart_from: chartFrom,
    chart_to: chartTo,
    cached_at: new Date().toISOString(),
    score_delta: scoreDelta(grade) + economicScoreBoost(metrics),
    risk_flag: riskFlagForGrade(grade) ?? riskFlagForEconomicEdge(metrics),
    method: 'walk_forward_3y',
    win_rate_ok: winRateOk,
    economic_edge_ok: edgeStatus === 'pass',
    economic_edge_status: edgeStatus,
    buy_hold_pct: buyHoldPct,
  };
}

export function hitsForTruthPreload(hits: Record<string, unknown>[], max = DEFAULT_MAX_PRELOAD): string[] {
  const cap = Math.max(1, Math.min(80, max));
  const edgeRank = (hit: Record<string, unknown>): number => {
    const truth = hit.backtest_truth as EconomicEdgeMetrics | undefined;
    if (!truth) return 1;
    const status = economicEdgeGateStatus(truth);
    if (status === 'pass') return 3;
    if (status === 'fail') return 0;
    return 1;
  };
  const tapeRank = (hit: Record<string, unknown>): number =>
    hit.volume_surge === true || hit.broke_swing_high === true ? 1 : 0;
  const sorted = [...hits].sort(
    (a, b) =>
      edgeRank(b) - edgeRank(a) ||
      tapeRank(b) - tapeRank(a) ||
      Number(b.r_multiple_ok === true) - Number(a.r_multiple_ok === true) ||
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
