/** Paper intraday wallet risk — test environment only. */

import {
  estimateFillCharges,
  estimateFillFeesInr,
  type EquitySettlement,
  type FillSide,
  type TradeChargeBreakdown,
} from '@sv/swing';

export type { EquitySettlement, FillSide, TradeChargeBreakdown };

export const PAPER_OPENING_BALANCE_INR = 100_000;
export const PAPER_MAX_NOTIONAL_INR = 30_000;
export const PAPER_MAX_OPEN_POSITIONS = 10;
export const PAPER_MAX_RISK_PER_TRADE_PCT = 1.0;
export const PAPER_MAX_HEAT_PCT = 4.0;
export const PAPER_DAILY_LOSS_KILL_PCT = 2.0;
export const PAPER_SLIPPAGE_BPS = 5;
/** @deprecated Prefer estimateFillCharges / estimateFeesInr with settlement — kept for docs parity. */
export const PAPER_ROUND_TRIP_FEE_PCT = 0.05;
export const PAPER_SOURCE = 'paper_auto';
export const PAPER_CURRENCY = 'INR';
/** Stratzy proof — paper auto always evaluates the 20 MA Stratzy preset (skips live >70% gate). */
export const PAPER_STRATEGY_PRESET = 'ma20_stratzy';
/** Stratzy paper tracks index BT book only (not liquid-stock basket). */
export const PAPER_STRATZY_INTERVAL = '15m' as const;
export const PAPER_STRATZY_INSTRUMENT_IDS = ['nifty50', 'banknifty'] as const;

/** Reject ETF/option marks used against index entries (e.g. NIFTYBEES ~278 vs Nifty ~24,300). */
export function isCompatibleMarkPrice(entry: number, mark: number, maxRelDev = 0.2): boolean {
  if (!(entry > 0) || !(mark > 0) || !Number.isFinite(entry) || !Number.isFinite(mark)) return false;
  const ratio = mark / entry;
  return ratio >= 1 - maxRelDev && ratio <= 1 + maxRelDev;
}

/** Last print must match the instrument scale — blocks NIFTYBEES cache pollution for NIFTY50. */
export function chartCloseMatchesInstrument(cacheKey: string, close: number): boolean {
  if (!(close > 0) || !Number.isFinite(close)) return false;
  const k = cacheKey.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (k === 'NIFTY50' || k === 'NIFTY' || k === 'FINNIFTY') return close >= 5000;
  if (k === 'BANKNIFTY') return close >= 10000;
  if (k === 'SENSEX' || k === 'BSESN') return close >= 20000;
  return true;
}

export function applySlippage(price: number, side: 'long' | 'short', isEntry: boolean): number {
  if (price <= 0) return price;
  const bps = PAPER_SLIPPAGE_BPS / 10_000;
  // Entry long / exit short → buy higher; entry short / exit long → sell lower
  const buying = (isEntry && side === 'long') || (!isEntry && side === 'short');
  const filled = buying ? price * (1 + bps) : price * (1 - bps);
  return Math.round(filled * 100) / 100;
}

/**
 * Per-fill NSE equity fee estimate (STT, stamp, exchange, SEBI, GST, DP, brokerage).
 * Defaults to intraday buy for legacy call sites that pass only notional.
 */
export function estimateFeesInr(
  notional: number,
  options: { side?: FillSide; settlement?: EquitySettlement } = {},
): number {
  return estimateFillFeesInr(notional, options.side ?? 'buy', options.settlement ?? 'intraday');
}

export function estimateFeesBreakdown(
  notional: number,
  options: { side?: FillSide; settlement?: EquitySettlement } = {},
): TradeChargeBreakdown {
  return estimateFillCharges({
    notional,
    side: options.side ?? 'buy',
    settlement: options.settlement ?? 'intraday',
  });
}

/**
 * Size shares from stop risk (≤1% equity) and hard notional cap (₹30k).
 * Returns 0 when trade cannot be sized safely.
 */
export function sizePaperShares(input: {
  entryPrice: number;
  stopLoss: number | null | undefined;
  equityInr: number;
  maxNotionalInr?: number;
  maxRiskPct?: number;
}): { shares: number; notional: number; riskInr: number; reason: string } {
  const entry = Number(input.entryPrice);
  const stop = Number(input.stopLoss ?? 0);
  const equity = Math.max(0, Number(input.equityInr));
  const maxNotional = input.maxNotionalInr ?? PAPER_MAX_NOTIONAL_INR;
  const maxRiskPct = input.maxRiskPct ?? PAPER_MAX_RISK_PER_TRADE_PCT;

  if (entry <= 0 || equity <= 0) {
    return { shares: 0, notional: 0, riskInr: 0, reason: 'Invalid price or equity.' };
  }

  const riskBudget = (equity * maxRiskPct) / 100;
  const riskPerShare = stop > 0 ? Math.abs(entry - stop) : entry * 0.01;
  if (riskPerShare <= 0) {
    return { shares: 0, notional: 0, riskInr: 0, reason: 'Invalid stop / risk per share.' };
  }

  const byRisk = Math.floor(riskBudget / riskPerShare);
  const byNotional = Math.floor(maxNotional / entry);
  const shares = Math.max(0, Math.min(byRisk, byNotional));
  if (shares < 1) {
    return {
      shares: 0,
      notional: 0,
      riskInr: 0,
      reason: `Cannot size ≥1 share under ₹${maxNotional} notional and ${maxRiskPct}% risk.`,
    };
  }

  const notional = Math.round(shares * entry * 100) / 100;
  const riskInr = Math.round(shares * riskPerShare * 100) / 100;
  return { shares, notional, riskInr, reason: '' };
}

export function canOpenPaperTrade(input: {
  openCount: number;
  heatPct: number;
  newRiskInr: number;
  equityInr: number;
  cashBalance: number;
  notional: number;
  sessionDayRealizedPnl: number;
}): { ok: boolean; reason: string } {
  if (input.openCount >= PAPER_MAX_OPEN_POSITIONS) {
    return { ok: false, reason: `Max open positions (${PAPER_MAX_OPEN_POSITIONS}) reached.` };
  }
  if (input.heatPct >= PAPER_MAX_HEAT_PCT) {
    return { ok: false, reason: `Portfolio heat ${input.heatPct.toFixed(1)}% ≥ ${PAPER_MAX_HEAT_PCT}%.` };
  }
  if (input.notional > PAPER_MAX_NOTIONAL_INR + 0.01) {
    return { ok: false, reason: `Notional ₹${input.notional} exceeds ₹${PAPER_MAX_NOTIONAL_INR} cap.` };
  }
  if (input.cashBalance < input.notional) {
    return { ok: false, reason: `Insufficient cash ₹${input.cashBalance.toFixed(0)} for ₹${input.notional}.` };
  }
  const kill = -(input.equityInr * PAPER_DAILY_LOSS_KILL_PCT) / 100;
  if (input.sessionDayRealizedPnl <= kill) {
    return {
      ok: false,
      reason: `Daily loss kill-switch: realized ₹${input.sessionDayRealizedPnl.toFixed(0)} ≤ ${PAPER_DAILY_LOSS_KILL_PCT}% of equity.`,
    };
  }
  const newHeat =
    input.equityInr > 0
      ? ((input.heatPct / 100) * input.equityInr + input.newRiskInr) / input.equityInr * 100
      : 99;
  if (newHeat > PAPER_MAX_HEAT_PCT + PAPER_MAX_RISK_PER_TRADE_PCT) {
    return { ok: false, reason: `New trade would push heat to ${newHeat.toFixed(1)}%.` };
  }
  return { ok: true, reason: '' };
}

export function positionRiskInr(entry: number, stop: number | null | undefined, shares: number): number {
  if (entry <= 0 || shares <= 0) return 0;
  const s = stop != null && stop > 0 ? stop : entry * 0.99;
  return Math.max(0, Math.abs(entry - s) * shares);
}

export function portfolioHeatPct(
  open: Array<{ entry_price: number; stop_loss?: number | null; quantity: number }>,
  equityInr: number,
): number {
  if (equityInr <= 0) return 0;
  const heat = open.reduce((sum, p) => sum + positionRiskInr(p.entry_price, p.stop_loss, p.quantity), 0);
  return Math.round((heat / equityInr) * 10000) / 100;
}

export interface PaperProofTrade {
  realized_pnl?: number | null;
  evidence?: unknown;
  source?: string | null;
  closed_at?: string | Date | null;
  /** Optional entry notional — enables return-% expectancy when present. */
  notional_inr?: number | null;
}

export interface PaperRegimeProofSlice {
  regime: PaperRegimeBucket;
  trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number | null;
  net_pnl_inr: number;
  /** Mean ₹ P&L per trade (expectancy). */
  expectancy_inr: number | null;
  /** Gross wins / abs(gross losses); null when no losses. */
  profit_factor: number | null;
  avg_win_inr: number | null;
  avg_loss_inr: number | null;
  /** Mean return % when notional is known for all trades in the slice. */
  expectancy_pct: number | null;
}

export interface PaperProofSummary {
  trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number | null;
  net_pnl_inr: number;
  expectancy_inr: number | null;
  profit_factor: number | null;
  stratzy_trades: number;
  /** Ready for evidence narrative when ≥5 Stratzy closes exist. */
  sample_ok: boolean;
  /** Economic proof sliced by entry NIFTYBEES regime (mandate: cycle stability). */
  by_regime: PaperRegimeProofSlice[];
}

/** Default lookback for rolling max drawdown on the paper dashboard. */
export const PAPER_ROLLING_DD_TRADES = 20;

export interface PaperEquityRiskStats {
  trades: number;
  equity_start_inr: number;
  equity_end_inr: number;
  peak_equity_inr: number;
  max_drawdown_inr: number;
  /** Peak-to-trough drawdown on the full closed-trade equity curve (%). */
  max_drawdown_pct: number;
  rolling_window_trades: number;
  /** Max drawdown on the last N closed trades only (%). */
  rolling_max_drawdown_pct: number;
  /**
   * Downside deviation of per-trade returns (vs equity before each trade), MAR=0.
   * Units: percent. Null when fewer than 2 closed trades.
   */
  downside_deviation_pct: number | null;
}

function maxDrawdownFromPnls(startEquity: number, pnls: number[]): {
  end: number;
  peak: number;
  maxDdInr: number;
  maxDdPct: number;
} {
  let equity = startEquity;
  let peak = startEquity;
  let maxDdInr = 0;
  let maxDdPct = 0;
  for (const pnl of pnls) {
    equity += pnl;
    if (equity > peak) peak = equity;
    const ddInr = peak - equity;
    const ddPct = peak > 0 ? (ddInr / peak) * 100 : 0;
    if (ddInr > maxDdInr) maxDdInr = ddInr;
    if (ddPct > maxDdPct) maxDdPct = ddPct;
  }
  return {
    end: Math.round(equity * 100) / 100,
    peak: Math.round(peak * 100) / 100,
    maxDdInr: Math.round(maxDdInr * 100) / 100,
    maxDdPct: Math.round(maxDdPct * 100) / 100,
  };
}

/**
 * Equity-curve risk for paper wallets: max DD, rolling max DD, downside deviation.
 * Closed trades should be chronological (oldest → newest); unsorted input is sorted by closed_at when present.
 */
export function computePaperEquityRisk(
  openingBalanceInr: number,
  closed: PaperProofTrade[],
  rollingWindow = PAPER_ROLLING_DD_TRADES,
): PaperEquityRiskStats {
  const start = Math.max(0, Number(openingBalanceInr) || 0);
  const sorted = closed
    .slice()
    .sort((a, b) => {
      const ta = a.closed_at ? new Date(a.closed_at).getTime() : 0;
      const tb = b.closed_at ? new Date(b.closed_at).getTime() : 0;
      if (ta !== tb) return ta - tb;
      return 0;
    });
  const pnls = sorted.map((t) => Number(t.realized_pnl ?? 0));
  const full = maxDrawdownFromPnls(start, pnls);

  const window = Math.max(1, Math.floor(rollingWindow));
  const rollPnls = pnls.slice(-window);
  const rollStart = full.end - rollPnls.reduce((s, p) => s + p, 0);
  const rolling = maxDrawdownFromPnls(rollStart, rollPnls);

  let downsideDeviation: number | null = null;
  if (pnls.length >= 2) {
    let equity = start;
    let sumSq = 0;
    for (const pnl of pnls) {
      const base = equity > 0 ? equity : start;
      const retPct = base > 0 ? (pnl / base) * 100 : 0;
      const downside = Math.min(retPct, 0);
      sumSq += downside * downside;
      equity += pnl;
    }
    downsideDeviation = Math.round(Math.sqrt(sumSq / pnls.length) * 100) / 100;
  }

  return {
    trades: pnls.length,
    equity_start_inr: Math.round(start * 100) / 100,
    equity_end_inr: full.end,
    peak_equity_inr: full.peak,
    max_drawdown_inr: full.maxDdInr,
    max_drawdown_pct: full.maxDdPct,
    rolling_window_trades: Math.min(window, pnls.length),
    rolling_max_drawdown_pct: rolling.maxDdPct,
    downside_deviation_pct: downsideDeviation,
  };
}

/** CFA live-money sample floors for out-of-sample paper evidence. */
export const PAPER_SAMPLE_MIN_TRADES = 30;
export const PAPER_SAMPLE_TARGET_TRADES = 50;
/** Min closes per cycle bucket (bull / sideways / bear) before CFA sample is cycle-ready. */
export const PAPER_SAMPLE_MIN_PER_REGIME = 5;
export const PAPER_SAMPLE_REGIME_KEYS = ['bull', 'sideways', 'bear'] as const;

export type PaperRegimeBucket = (typeof PAPER_SAMPLE_REGIME_KEYS)[number] | 'unknown';

export type PaperRegimeCounts = Record<PaperRegimeBucket, number>;

export interface PaperSampleProgress {
  closed_trades: number;
  archived_trades: number;
  total_trades: number;
  min_trades: number;
  target_trades: number;
  pct_to_min: number;
  pct_to_target: number;
  min_ready: boolean;
  target_ready: boolean;
  status: 'insufficient' | 'minimum_met' | 'target_met';
  summary: string;
  /** Closed trades by NIFTYBEES regime at entry (current + archived). */
  regimes: PaperRegimeCounts;
  min_per_regime: number;
  regimes_covered: number;
  regimes_needed: number;
  cycle_ready: boolean;
  cycle_gaps: string[];
}

export function emptyPaperRegimeCounts(): PaperRegimeCounts {
  return { bull: 0, sideways: 0, bear: 0, unknown: 0 };
}

/** Map engine regime key → CFA cycle bucket (neutral → sideways). */
export function normalizePaperRegimeKey(raw: unknown): PaperRegimeBucket {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (key === 'bull') return 'bull';
  if (key === 'bear') return 'bear';
  if (key === 'sideways' || key === 'neutral') return 'sideways';
  return 'unknown';
}

export function regimeKeyFromEvidence(evidence: unknown): PaperRegimeBucket {
  const ev = (evidence ?? null) as Record<string, unknown> | null;
  let raw: unknown = ev?.regime_key;
  if (raw == null && ev?.regime != null) {
    const reg = ev.regime;
    raw = typeof reg === 'object' && reg !== null ? (reg as Record<string, unknown>).key : reg;
  }
  return normalizePaperRegimeKey(raw);
}

export function mergePaperRegimeCounts(
  ...parts: Array<Partial<PaperRegimeCounts> | null | undefined>
): PaperRegimeCounts {
  const out = emptyPaperRegimeCounts();
  for (const part of parts) {
    if (!part) continue;
    for (const key of [...PAPER_SAMPLE_REGIME_KEYS, 'unknown'] as const) {
      out[key] += Math.max(0, Math.floor(Number(part[key] ?? 0)));
    }
  }
  return out;
}

/** Count closed paper trades by entry-regime stamp on evidence. */
export function countPaperRegimeCloses(
  trades: Array<{ evidence?: unknown } | null | undefined>,
): PaperRegimeCounts {
  const out = emptyPaperRegimeCounts();
  for (const trade of trades) {
    out[regimeKeyFromEvidence(trade?.evidence)] += 1;
  }
  return out;
}

/**
 * Progress toward CFA 30–50 independent out-of-sample paper closes.
 * Counts current-period closes + archived period closes (evaluation resets keep history).
 * Cycle readiness also requires ≥ min_per_regime closes in bull, sideways and bear.
 */
export function computePaperSampleProgress(input: {
  current_closed_trades: number;
  archived_closed_trades?: number;
  min_trades?: number;
  target_trades?: number;
  regime_counts?: Partial<PaperRegimeCounts> | null;
  min_per_regime?: number;
}): PaperSampleProgress {
  const min = Math.max(1, Math.floor(input.min_trades ?? PAPER_SAMPLE_MIN_TRADES));
  const target = Math.max(min, Math.floor(input.target_trades ?? PAPER_SAMPLE_TARGET_TRADES));
  const minPer = Math.max(1, Math.floor(input.min_per_regime ?? PAPER_SAMPLE_MIN_PER_REGIME));
  const current = Math.max(0, Math.floor(input.current_closed_trades));
  const archived = Math.max(0, Math.floor(input.archived_closed_trades ?? 0));
  const total = current + archived;
  const regimes = mergePaperRegimeCounts(input.regime_counts);
  const cycleGaps = PAPER_SAMPLE_REGIME_KEYS.filter((key) => regimes[key] < minPer).map(
    (key) => `${key} ${regimes[key]}/${minPer}`,
  );
  const regimesCovered = PAPER_SAMPLE_REGIME_KEYS.filter((key) => regimes[key] >= minPer).length;
  const cycleReady = cycleGaps.length === 0;
  const pctMin = Math.min(100, Math.round((total / min) * 1000) / 10);
  const pctTarget = Math.min(100, Math.round((total / target) * 1000) / 10);
  const countMinReady = total >= min;
  const countTargetReady = total >= target;
  const minReady = countMinReady && cycleReady;
  const targetReady = countTargetReady && cycleReady;
  const status = targetReady ? 'target_met' : minReady ? 'minimum_met' : 'insufficient';

  let summary: string;
  if (targetReady) {
    summary = `Sample ready: ${total}/${target} closes across bull/sideways/bear (CFA target met).`;
  } else if (countTargetReady && !cycleReady) {
    summary = `Headcount ${total}/${target} met — need cycle coverage: ${cycleGaps.join(', ')}.`;
  } else if (minReady) {
    summary = `Minimum met: ${total}/${min} closes with cycle coverage — continue to ${target} for stronger OOS evidence.`;
  } else if (countMinReady && !cycleReady) {
    summary = `Headcount ${total}/${min} met — need cycle coverage: ${cycleGaps.join(', ')}.`;
  } else {
    const needCount = Math.max(0, min - total);
    summary = cycleReady
      ? `Need ${needCount} more closed paper trade(s) to reach CFA minimum ${min} (target ${target}).`
      : `Need ${needCount} more close(s) to ${min} and cycle coverage: ${cycleGaps.join(', ')}.`;
  }

  return {
    closed_trades: current,
    archived_trades: archived,
    total_trades: total,
    min_trades: min,
    target_trades: target,
    pct_to_min: pctMin,
    pct_to_target: pctTarget,
    min_ready: minReady,
    target_ready: targetReady,
    status,
    summary,
    regimes,
    min_per_regime: minPer,
    regimes_covered: regimesCovered,
    regimes_needed: PAPER_SAMPLE_REGIME_KEYS.length,
    cycle_ready: cycleReady,
    cycle_gaps: cycleGaps,
  };
}

/** Aggregate closed paper trades into a Stratzy proof scorecard. */
export function summarizePaperProof(closed: PaperProofTrade[]): PaperProofSummary {
  const overall = summarizePnlBucket(closed);
  let stratzy = 0;
  for (const t of closed) {
    const ev = t.evidence as { preset?: string } | null;
    if (t.source === PAPER_SOURCE || ev?.preset === PAPER_STRATEGY_PRESET) stratzy += 1;
  }

  const buckets: Record<PaperRegimeBucket, PaperProofTrade[]> = {
    bull: [],
    sideways: [],
    bear: [],
    unknown: [],
  };
  for (const trade of closed) {
    buckets[regimeKeyFromEvidence(trade.evidence)].push(trade);
  }

  const byRegime: PaperRegimeProofSlice[] = (
    [...PAPER_SAMPLE_REGIME_KEYS, 'unknown'] as PaperRegimeBucket[]
  ).map((regime) => {
    const slice = summarizePnlBucket(buckets[regime]);
    return { regime, ...slice };
  });

  return {
    trades: overall.trades,
    wins: overall.wins,
    losses: overall.losses,
    win_rate_pct: overall.win_rate_pct,
    net_pnl_inr: overall.net_pnl_inr,
    expectancy_inr: overall.expectancy_inr,
    profit_factor: overall.profit_factor,
    stratzy_trades: stratzy,
    sample_ok: stratzy >= 5,
    by_regime: byRegime,
  };
}

/** Pause new Stratzy paper entries when index-book proof is large enough and still uneconomic. */
export const STRATZY_PAPER_ECON_PAUSE_MIN_TRADES = 10;

export function stratzyPaperEconomicPauseReasons(proof: {
  trades: number;
  expectancy_inr: number | null;
  profit_factor: number | null;
}): string[] {
  if (proof.trades < STRATZY_PAPER_ECON_PAUSE_MIN_TRADES) return [];
  const reasons: string[] = [];
  if (proof.expectancy_inr != null && !(proof.expectancy_inr > 0)) {
    reasons.push(
      `Index Stratzy paper expectancy ₹${proof.expectancy_inr}/trade ≤ 0 after ${proof.trades} closes — pause new entries`,
    );
  }
  if (proof.profit_factor != null && proof.profit_factor < 1.25) {
    reasons.push(
      `Index Stratzy paper PF ${proof.profit_factor} < 1.25 after ${proof.trades} closes — pause new entries`,
    );
  }
  return reasons;
}

function summarizePnlBucket(closed: PaperProofTrade[]): Omit<PaperRegimeProofSlice, 'regime'> {
  const trades = closed.length;
  let wins = 0;
  let losses = 0;
  let net = 0;
  let grossWins = 0;
  let grossLosses = 0;
  let returnSum = 0;
  let returnN = 0;
  for (const t of closed) {
    const pnl = Number(t.realized_pnl ?? 0);
    net += pnl;
    if (pnl > 0) {
      wins += 1;
      grossWins += pnl;
    } else if (pnl < 0) {
      losses += 1;
      grossLosses += Math.abs(pnl);
    }
    const notional = Number(t.notional_inr ?? 0);
    if (notional > 0) {
      returnSum += (pnl / notional) * 100;
      returnN += 1;
    }
  }
  const expectancy = trades > 0 ? Math.round((net / trades) * 100) / 100 : null;
  let profitFactor: number | null = null;
  if (trades > 0) {
    if (grossLosses > 0) profitFactor = Math.round((grossWins / grossLosses) * 100) / 100;
    else if (grossWins <= 0) profitFactor = 0;
    // winners only → null (undefined / infinite PF)
  }
  return {
    trades,
    wins,
    losses,
    win_rate_pct: trades > 0 ? Math.round((wins / trades) * 1000) / 10 : null,
    net_pnl_inr: Math.round(net * 100) / 100,
    expectancy_inr: expectancy,
    profit_factor: profitFactor,
    avg_win_inr: wins > 0 ? Math.round((grossWins / wins) * 100) / 100 : null,
    avg_loss_inr: losses > 0 ? Math.round((-grossLosses / losses) * 100) / 100 : null,
    expectancy_pct:
      returnN > 0 && returnN === trades ? Math.round((returnSum / returnN) * 100) / 100 : null,
  };
}
