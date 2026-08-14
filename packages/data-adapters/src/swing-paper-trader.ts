import { createHash } from 'node:crypto';
import { acquireCacheLock, releaseCacheLock } from '@sv/cache';
import {
  PaperLedgerType,
  PaperOrderStatus,
  PaperPositionStatus,
  prisma,
} from '@sv/db';
import {
  canOpenPaperTrade,
  estimateFeesBreakdown,
  isCompatibleMarkPrice,
  PAPER_CURRENCY,
  PAPER_OPENING_BALANCE_INR,
  PAPER_ROLLING_DD_TRADES,
  PAPER_SAMPLE_MIN_PER_REGIME,
  PAPER_SAMPLE_MIN_TRADES,
  PAPER_SAMPLE_TARGET_TRADES,
  portfolioHeatPct,
  computePaperEquityRisk,
  computePaperSampleProgress,
  countPaperRegimeCloses,
  mergePaperRegimeCounts,
  sizePaperShares,
  summarizePaperProof,
  type PaperRegimeCounts,
} from '@sv/intraday';
import {
  ACTION_SKIP,
  canOpenSectorConcentration,
  categorizeHits,
  economicEdgeGateReasons,
  MAX_SECTOR_NOTIONAL_PCT,
  refreshPosition,
  resolvePositionSector,
  SWING_PARTIAL_RR,
  SWING_PARTIAL_WEIGHTS,
} from '@sv/swing';
import { nseSession } from '@sv/shared';
import { attachBacktestTruthToHits } from './auto-backtest-truth.js';
import { attachFundamentalQualityToHits } from './fundamental-quality-attach.js';
import { getSwingAutoSnapshotDurable } from './auto-swing-scan.js';
import { buildSymbolContext } from './swing-scan.js';
import { currentMarketRegime } from './market-regime.js';
import { liveQuoteForSymbol } from './live-quote.js';
import { bookPaperPartial, closePaperPosition, ensurePaperWallet } from './intraday-paper-trader.js';
import { alertsFromSwingPaperTick, notifyTradeSignalEmails } from './signal-alerts.js';

export const SWING_PAPER_SOURCE = 'swing_paper_auto';
export const SWING_PAPER_MIN_BT_TRADES = 10;
export const SWING_PAPER_SOFT_WIN_RATE_PCT = 70;
export const SWING_PAPER_MAX_ENTRIES_PER_TICK = 2;
export const SWING_PAPER_MAX_SNAPSHOT_AGE_SEC = 15 * 60;
export const SWING_PAPER_ARM_PREFIX = 'swing_paper_auto:';
const SWING_PAPER_PERIOD_PREFIX = 'swing_paper_period:';
const SWING_PAPER_ARCHIVES_PREFIX = 'swing_paper_archives:';
const SWING_PAPER_TICK_LOCK = 'sv:lock:swing-paper-tick';
const MAX_ARCHIVES_KEPT = 40;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function istSessionDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

export interface SwingPaperPeriod {
  id: string;
  label: string;
  started_at: string;
  equity_start_inr: number;
}

export interface SwingPaperArchiveEntry {
  id: string;
  label: string;
  started_at: string;
  ended_at: string;
  equity_start_inr: number;
  equity_end_inr: number;
  wallet_reset: boolean;
  proof: ReturnType<typeof summarizePaperProof>;
  risk: ReturnType<typeof computePaperEquityRisk>;
  closed_trade_count: number;
  /** Entry-regime buckets for this archived period (for CFA cycle coverage). */
  regime_counts?: PaperRegimeCounts;
}

function asJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as object;
}

function newPeriodId(): string {
  return `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}


async function readArchives(userId: string): Promise<SwingPaperArchiveEntry[]> {
  const row = await prisma.appSetting.findUnique({
    where: { key: `${SWING_PAPER_ARCHIVES_PREFIX}${userId}` },
  });
  const value = row?.value;
  return Array.isArray(value) ? (value as unknown as SwingPaperArchiveEntry[]) : [];
}

async function ensureSwingPaperPeriod(
  userId: string,
  equityStartInr: number,
): Promise<SwingPaperPeriod> {
  const key = `${SWING_PAPER_PERIOD_PREFIX}${userId}`;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const value = row?.value as SwingPaperPeriod | null;
  if (value && typeof value === 'object' && value.id && value.started_at) {
    return {
      id: String(value.id),
      label: String(value.label || 'Current period'),
      started_at: String(value.started_at),
      equity_start_inr: Number(value.equity_start_inr ?? equityStartInr),
    };
  }
  const period: SwingPaperPeriod = {
    id: newPeriodId(),
    label: 'Period 1',
    started_at: new Date().toISOString(),
    equity_start_inr: round2(equityStartInr),
  };
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: asJson(period), updatedBy: userId },
    update: { value: asJson(period), updatedBy: userId },
  });
  return period;
}

function inCurrentPeriod(
  closedAt: Date | null | undefined,
  periodStartedAt: string,
): boolean {
  if (!closedAt) return false;
  return closedAt.getTime() >= new Date(periodStartedAt).getTime();
}

function sessionDateObj(isoDate = istSessionDate()): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function swingOrderId(userId: string, symbol: string, snapshotAt: string): string {
  return createHash('sha256')
    .update(['swing-paper-open', userId, symbol, snapshotAt.slice(0, 16)].join('|'))
    .digest('hex')
    .slice(0, 32);
}

async function isSwingPaperArmed(userId: string): Promise<boolean> {
  const setting = await prisma.appSetting.findUnique({
    where: { key: `${SWING_PAPER_ARM_PREFIX}${userId}` },
  });
  return setting?.value === true;
}

function mapSwingPaperPosition(position: {
  id: string;
  symbol: string;
  status: string;
  quantity: number;
  entryPrice: number;
  entryTime: Date;
  stopLoss: number | null;
  effectiveStop: number | null;
  targetT1: number | null;
  notionalInr: number;
  realizedPnl: number | null;
  closedAt: Date | null;
  closedPrice: number | null;
  closedReason: string | null;
  evidence: unknown;
}) {
  return {
    id: position.id,
    symbol: position.symbol,
    status: position.status,
    quantity: position.quantity,
    entry_price: position.entryPrice,
    entry_time: position.entryTime.toISOString(),
    stop_loss: position.stopLoss,
    effective_stop: position.effectiveStop,
    target: position.targetT1,
    notional_inr: position.notionalInr,
    realized_pnl: position.realizedPnl,
    closed_at: position.closedAt?.toISOString() ?? null,
    closed_price: position.closedPrice,
    closed_reason: position.closedReason,
    evidence: position.evidence,
  };
}

/**
 * Paper-only High Conviction gate.
 * Hard: fresh HC + Strict ENTER + ≥10 BT trades + economic edge + 3R.
 * Soft (recorded, never blocking): ≥70% WR diagnostic.
 */
export function swingPaperSoftFlags(hit: Record<string, unknown>): string[] {
  const soft: string[] = [];
  const truth = hit.backtest_truth as Record<string, unknown> | undefined;
  if (truth && Number(truth.trades_closed ?? 0) >= SWING_PAPER_MIN_BT_TRADES) {
    const wr = Number(truth.win_rate_pct ?? 0);
    if (wr < SWING_PAPER_SOFT_WIN_RATE_PCT) {
      soft.push(`soft: BT win rate ${wr}% below ${SWING_PAPER_SOFT_WIN_RATE_PCT}%`);
    }
  }
  return soft;
}

export function swingPaperCandidateReasons(hit: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  if (hit.already_held) reasons.push('already held');
  if (hit.incremental_stale) reasons.push('stale carried data');
  if (String(hit.decision_action ?? '') === ACTION_SKIP) reasons.push('decision is SKIP');
  if (hit.sleeve_blocks_swing_paper === true || String(hit.sleeve ?? '') === 'compounder') {
    reasons.push('compounder sleeve — use positional moat book, not Swing paper');
  }
  if (hit.high_conviction !== true) reasons.push('not High Conviction');
  if (String(hit.strict_verdict ?? '') !== 'ENTER') reasons.push('strict verdict is not ENTER');
  if (hit.strict_enter_ready === false) reasons.push('strict gate is not ready');
  if (hit.r_multiple_ok !== true) reasons.push('R multiple is below minimum');
  if (hit.net_edge_ok === false) reasons.push('net edge is below floor');
  if (hit.fundamental_quality_ok === false) {
    reasons.push(String(hit.fundamental_quality_summary ?? 'ROE & ROCE must both be ≥ 15%'));
  }

  const truth = hit.backtest_truth as Record<string, unknown> | undefined;
  if (!truth) {
    reasons.push('Backtest evidence missing');
  } else if (Number(truth.trades_closed ?? 0) < SWING_PAPER_MIN_BT_TRADES) {
    reasons.push(`Backtest sample below ${SWING_PAPER_MIN_BT_TRADES} trades`);
  } else {
    reasons.push(
      ...economicEdgeGateReasons({
        trades_closed: Number(truth.trades_closed ?? 0),
        profit_factor: Number(truth.profit_factor ?? 0),
        compounded_return_pct: Number(truth.compounded_return_pct ?? 0),
        max_drawdown_pct: Number(truth.max_drawdown_pct ?? 0),
        expectancy_pct: Number(truth.expectancy_pct ?? 0),
        win_rate_pct: Number(truth.win_rate_pct ?? 0),
        avg_win_pct: Number(truth.avg_win_pct ?? 0),
        avg_loss_pct: Number(truth.avg_loss_pct ?? 0),
      }),
    );
  }

  // Soft ≥70% WR remains diagnostic only (see swingPaperSoftFlags).
  return [...new Set(reasons)];
}

export async function getSwingPaperState(userId: string) {
  await ensurePaperWallet(userId);
  const wallet = await prisma.paperWallet.findUniqueOrThrow({
    where: { userId_currency: { userId, currency: PAPER_CURRENCY } },
  });
  const equity = wallet.cashBalance + wallet.reservedCash;
  const period = await ensureSwingPaperPeriod(userId, equity);
  const archives = await readArchives(userId);
  const [open, closedAll] = await Promise.all([
    prisma.paperPosition.findMany({
      where: { userId, status: PaperPositionStatus.open, source: SWING_PAPER_SOURCE },
      orderBy: { entryTime: 'desc' },
    }),
    prisma.paperPosition.findMany({
      where: { userId, status: PaperPositionStatus.closed, source: SWING_PAPER_SOURCE },
      orderBy: { closedAt: 'desc' },
      take: 500,
    }),
  ]);
  const closed = closedAll.filter((position) => inCurrentPeriod(position.closedAt, period.started_at));
  const proof = summarizePaperProof(
    closed.map((position) => ({
      realized_pnl: position.realizedPnl,
      evidence: position.evidence,
      source: position.source,
      notional_inr: position.notionalInr,
    })),
  );
  const risk = computePaperEquityRisk(
    period.equity_start_inr,
    closed.map((position) => ({
      realized_pnl: position.realizedPnl,
      closed_at: position.closedAt,
      evidence: position.evidence,
      source: position.source,
    })),
    PAPER_ROLLING_DD_TRADES,
  );
  const archivedTrades = archives.reduce(
    (sum, row) => sum + Number(row.closed_trade_count ?? row.proof?.trades ?? 0),
    0,
  );
  const currentRegimes = countPaperRegimeCloses(
    closed.map((position) => ({ evidence: position.evidence })),
  );
  const archivedRegimes = mergePaperRegimeCounts(
    ...archives.map((row) => row.regime_counts),
  );
  const sample = computePaperSampleProgress({
    current_closed_trades: closed.length,
    archived_closed_trades: archivedTrades,
    min_trades: PAPER_SAMPLE_MIN_TRADES,
    target_trades: PAPER_SAMPLE_TARGET_TRADES,
    min_per_regime: PAPER_SAMPLE_MIN_PER_REGIME,
    regime_counts: mergePaperRegimeCounts(currentRegimes, archivedRegimes),
  });
  const swingAutoArmed = await isSwingPaperArmed(userId);
  return {
    ok: true,
    wallet: {
      opening_balance: wallet.openingBalance,
      cash_balance: round2(wallet.cashBalance),
      reserved_cash: round2(wallet.reservedCash),
      equity_inr: round2(equity),
      realized_pnl: round2(wallet.realizedPnl),
      swing_auto_armed: swingAutoArmed,
      last_tick_at: wallet.lastTickAt?.toISOString() ?? null,
    },
    period,
    archives: archives.slice(0, 12),
    open_positions: open.map(mapSwingPaperPosition),
    closed_positions: closed.map(mapSwingPaperPosition),
    heat_pct: portfolioHeatPct(
      open.map((position) => ({
        entry_price: position.entryPrice,
        stop_loss: position.effectiveStop ?? position.stopLoss,
        quantity: position.quantity,
      })),
      equity,
    ),
    proof,
    risk,
    sample,
    policy: {
      source: SWING_PAPER_SOURCE,
      paper_only: true,
      high_conviction_only: true,
      strict_enter_only: true,
      min_bt_trades: SWING_PAPER_MIN_BT_TRADES,
      soft_r_multiple: true,
      soft_min_bt_win_rate_pct: SWING_PAPER_SOFT_WIN_RATE_PCT,
      // Kept for UI compatibility — soft diagnostic floor, not a hard gate.
      min_bt_win_rate_pct: SWING_PAPER_SOFT_WIN_RATE_PCT,
      fresh_snapshot_max_age_sec: SWING_PAPER_MAX_SNAPSHOT_AGE_SEC,
      max_entries_per_tick: SWING_PAPER_MAX_ENTRIES_PER_TICK,
      max_sector_notional_pct: MAX_SECTOR_NOTIONAL_PCT,
      rolling_dd_trades: PAPER_ROLLING_DD_TRADES,
      fee_model: 'nse_equity_cash',
      fee_settlement: 'delivery',
      fee_components: ['brokerage', 'stt', 'stamp', 'nse_txn', 'sebi', 'gst', 'dp'],
      sample_min_trades: PAPER_SAMPLE_MIN_TRADES,
      sample_target_trades: PAPER_SAMPLE_TARGET_TRADES,
      sample_min_per_regime: PAPER_SAMPLE_MIN_PER_REGIME,
    },
    nse: nseSession(),
  };
}

/**
 * Archive the current Swing paper evaluation period and start a fresh one.
 * Optional wallet reset requires a flat book (no open paper positions of any source).
 */
export async function archiveSwingPaperPeriod(
  userId: string,
  options: { label?: string; reset_wallet?: boolean } = {},
) {
  await ensurePaperWallet(userId);
  const wallet = await prisma.paperWallet.findUniqueOrThrow({
    where: { userId_currency: { userId, currency: PAPER_CURRENCY } },
  });
  const equity = wallet.cashBalance + wallet.reservedCash;
  const period = await ensureSwingPaperPeriod(userId, equity);
  const resetWallet = Boolean(options.reset_wallet);

  const openSwing = await prisma.paperPosition.count({
    where: { userId, status: PaperPositionStatus.open, source: SWING_PAPER_SOURCE },
  });
  if (openSwing > 0) {
    return {
      ok: false as const,
      error: `Close ${openSwing} open Swing paper position(s) before archiving the evaluation period.`,
    };
  }

  if (resetWallet) {
    const openAny = await prisma.paperPosition.count({
      where: { userId, status: PaperPositionStatus.open },
    });
    if (openAny > 0) {
      return {
        ok: false as const,
        error: `Wallet reset blocked — ${openAny} open paper position(s) remain (Swing or intraday).`,
      };
    }
  }

  const closedAll = await prisma.paperPosition.findMany({
    where: { userId, status: PaperPositionStatus.closed, source: SWING_PAPER_SOURCE },
    orderBy: { closedAt: 'asc' },
    take: 500,
  });
  const closed = closedAll.filter((position) => inCurrentPeriod(position.closedAt, period.started_at));
  const proof = summarizePaperProof(
    closed.map((position) => ({
      realized_pnl: position.realizedPnl,
      evidence: position.evidence,
      source: position.source,
      notional_inr: position.notionalInr,
    })),
  );
  const risk = computePaperEquityRisk(
    period.equity_start_inr,
    closed.map((position) => ({
      realized_pnl: position.realizedPnl,
      closed_at: position.closedAt,
      evidence: position.evidence,
      source: position.source,
    })),
  );

  const endedAt = new Date().toISOString();
  const archiveLabel =
    String(options.label ?? '').trim() ||
    period.label ||
    `Period ending ${endedAt.slice(0, 10)}`;

  const archive: SwingPaperArchiveEntry = {
    id: period.id,
    label: archiveLabel,
    started_at: period.started_at,
    ended_at: endedAt,
    equity_start_inr: period.equity_start_inr,
    equity_end_inr: round2(equity),
    wallet_reset: resetWallet,
    proof,
    risk,
    closed_trade_count: closed.length,
    regime_counts: countPaperRegimeCloses(
      closed.map((position) => ({ evidence: position.evidence })),
    ),
  };

  const prior = await readArchives(userId);
  const archives = [archive, ...prior].slice(0, MAX_ARCHIVES_KEPT);
  await prisma.appSetting.upsert({
    where: { key: `${SWING_PAPER_ARCHIVES_PREFIX}${userId}` },
    create: { key: `${SWING_PAPER_ARCHIVES_PREFIX}${userId}`, value: asJson(archives), updatedBy: userId },
    update: { value: asJson(archives), updatedBy: userId },
  });

  await setSwingPaperAutoArmed(userId, false);

  let equityStart = round2(equity);
  if (resetWallet) {
    await prisma.$transaction(async (tx) => {
      const latest = await tx.paperWallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const opening = Number(latest.openingBalance || PAPER_OPENING_BALANCE_INR);
      await tx.paperWallet.update({
        where: { id: wallet.id },
        data: {
          cashBalance: opening,
          reservedCash: 0,
          realizedPnl: 0,
          autoArmed: false,
        },
      });
      await tx.paperLedgerEntry.create({
        data: {
          walletId: wallet.id,
          type: PaperLedgerType.adjustment,
          amountInr: round2(opening - latest.cashBalance),
          balanceAfter: opening,
          refType: 'swing_paper_archive',
          refId: period.id,
          meta: {
            note: 'Swing paper evaluation period archive — wallet reset to opening balance',
            archive_id: period.id,
            prior_cash: latest.cashBalance,
            prior_realized_pnl: latest.realizedPnl,
          },
        },
      });
    });
    equityStart = Number(wallet.openingBalance || PAPER_OPENING_BALANCE_INR);
  }

  const nextPeriod: SwingPaperPeriod = {
    id: newPeriodId(),
    label: `Period ${archives.length + 1}`,
    started_at: new Date().toISOString(),
    equity_start_inr: round2(equityStart),
  };
  await prisma.appSetting.upsert({
    where: { key: `${SWING_PAPER_PERIOD_PREFIX}${userId}` },
    create: {
      key: `${SWING_PAPER_PERIOD_PREFIX}${userId}`,
      value: asJson(nextPeriod),
      updatedBy: userId,
    },
    update: { value: asJson(nextPeriod), updatedBy: userId },
  });

  return {
    ok: true as const,
    archive,
    period: nextPeriod,
    wallet_reset: resetWallet,
    archives_count: archives.length,
  };
}

export async function setSwingPaperAutoArmed(userId: string, armed: boolean) {
  await ensurePaperWallet(userId);
  await prisma.appSetting.upsert({
    where: { key: `${SWING_PAPER_ARM_PREFIX}${userId}` },
    create: {
      key: `${SWING_PAPER_ARM_PREFIX}${userId}`,
      value: armed,
      updatedBy: userId,
    },
    update: { value: armed, updatedBy: userId },
  });
  return {
    ok: true,
    swing_auto_armed: armed,
  };
}

async function manageSwingPaperPositions(userId: string) {
  const open = await prisma.paperPosition.findMany({
    where: { userId, status: PaperPositionStatus.open, source: SWING_PAPER_SOURCE },
  });
  const regime = await currentMarketRegime(false);
  const actions: Array<Record<string, unknown>> = [];

  for (const position of open) {
    const context = await buildSymbolContext(position.symbol, true, { include_hourly: true });
    if (!context) {
      actions.push({ symbol: position.symbol, action: 'SKIP', reason: 'Chart unavailable' });
      continue;
    }
    const barPrice = Number(
      context.ta.ta_price ?? context.bars[context.bars.length - 1]?.close ?? position.entryPrice,
    );
    const quote = await liveQuoteForSymbol(position.symbol, true);
    const price = quote && quote > 0 ? quote : barPrice;
    const evidence = (position.evidence as Record<string, unknown> | null) ?? {};
    const refreshed = refreshPosition(
      {
        id: position.id,
        symbol: position.symbol,
        entry_price: position.entryPrice,
        entry_date: position.entryTime.toISOString().slice(0, 10),
        shares: position.quantity,
        stop_loss: position.stopLoss,
        profit_target: position.targetT3 ?? position.targetT1,
        highest_since_entry: Number(evidence.highest_since_entry ?? position.entryPrice),
        trailed_stop_loss: position.effectiveStop,
      },
      {
        ta: context.ta,
        price,
        bars: context.bars,
        hourlyBars: context.hourlyBars,
        regime,
      },
    );

    // Scale-out parity with BT book (40/40/20 @1R/2R) before full X1–X9 exit.
    const t1 = Number(position.targetT1 ?? 0);
    const t2 = Number(position.targetT2 ?? 0);
    const base = {
      id: position.id,
      symbol: position.symbol,
      instrument_label: position.instrumentLabel || position.symbol,
      side: position.side,
      timeframe: position.timeframe,
      quantity: position.quantity,
      entry_price: position.entryPrice,
      stop_loss: position.stopLoss,
      effective_stop: position.effectiveStop,
      target_t1: position.targetT1,
      target_t2: position.targetT2,
      target_t3: position.targetT3 ?? position.targetT1,
      remaining_pct: position.remainingPct ?? 100,
      t1_booked: position.t1Booked,
      t2_booked: position.t2Booked,
      notional_inr: position.notionalInr,
      realized_pnl: position.realizedPnl,
      action_label: refreshed.action_label ?? refreshed.position_action,
    };
    if (!isCompatibleMarkPrice(position.entryPrice, price)) {
      actions.push({
        ...base,
        action: 'SKIP',
        reason: `Mark ₹${price} incompatible with entry ₹${position.entryPrice}`,
        price,
      });
      continue;
    }
    if (!position.t1Booked && t1 > 0 && price >= t1) {
      const booked = await bookPaperPartial(userId, position.id, price, 'PARTIAL_T1');
      actions.push({
        ...base,
        action: 'PARTIAL_T1',
        booked: Boolean(booked),
        price,
        remaining_pct: booked?.remaining_pct ?? base.remaining_pct,
        realized_pnl: booked?.realized_pnl ?? base.realized_pnl,
      });
      continue;
    }
    if (position.t1Booked && !position.t2Booked && t2 > 0 && price >= t2) {
      const booked = await bookPaperPartial(userId, position.id, price, 'PARTIAL_T2');
      actions.push({
        ...base,
        action: 'PARTIAL_T2',
        booked: Boolean(booked),
        price,
        remaining_pct: booked?.remaining_pct ?? base.remaining_pct,
        realized_pnl: booked?.realized_pnl ?? base.realized_pnl,
      });
      continue;
    }

    const action = String(refreshed.position_action ?? 'HOLD');
    const shouldClose =
      refreshed.exit_verdict === 'EXIT' || ['EXIT_NOW', 'CUT_LOSS'].includes(action);
    if (shouldClose) {
      const closed = await closePaperPosition(userId, position.id, price, action);
      actions.push({
        ...base,
        action,
        closed: Boolean(closed),
        price,
        realized_pnl: closed?.realized_pnl ?? base.realized_pnl,
        closed_reason: closed?.closed_reason ?? action,
      });
      continue;
    }

    const nextStop = Number(
      refreshed.suggested_trailed_stop ?? refreshed.active_stop ?? position.effectiveStop ?? 0,
    );
    await prisma.paperPosition.update({
      where: { id: position.id },
      data: {
        effectiveStop: nextStop > 0 ? nextStop : position.effectiveStop,
        evidence: {
          ...evidence,
          highest_since_entry: refreshed.highest_since_entry,
          last_price: price,
          last_action: action,
          last_action_reasons: refreshed.action_reasons,
          last_evaluated_at: new Date().toISOString(),
        },
      },
    });
    actions.push({ ...base, action, price, effective_stop: nextStop || null });
  }
  return actions;
}

async function openSwingPaperCandidate(
  userId: string,
  hit: Record<string, unknown>,
  snapshotAt: string,
  regime?: Record<string, unknown> | null,
) {
  const symbol = String(hit.symbol ?? '').toUpperCase();
  const truth = hit.backtest_truth as Record<string, unknown> | undefined;
  const gateReasons = swingPaperCandidateReasons(hit);
  if (gateReasons.length > 0) {
    return { skipped: true as const, symbol, reason: gateReasons.join(' · ') };
  }
  if (!truth) return { skipped: true as const, symbol, reason: 'Backtest evidence missing' };
  const softFlags = swingPaperSoftFlags(hit);

  const wallet = await prisma.paperWallet.findUniqueOrThrow({
    where: { userId_currency: { userId, currency: PAPER_CURRENCY } },
  });
  const duplicate = await prisma.paperPosition.findFirst({
    where: { userId, symbol, status: PaperPositionStatus.open },
  });
  if (duplicate) return { skipped: true as const, symbol, reason: 'Already open in paper wallet' };

  const quote = await liveQuoteForSymbol(symbol, true);
  const entryPrice = round2(quote && quote > 0 ? quote : Number(hit.price ?? 0));
  const stopLoss = round2(Number(hit.stop_loss ?? 0));
  const target = round2(Number(hit.profit_target ?? 0));
  if (entryPrice <= 0 || stopLoss <= 0 || stopLoss >= entryPrice || target <= entryPrice) {
    return { skipped: true as const, symbol, reason: 'Invalid live entry/stop/target geometry' };
  }
  const riskPts = entryPrice - stopLoss;
  const targetT1 = round2(entryPrice + SWING_PARTIAL_RR[0] * riskPts);
  const targetT2 = round2(entryPrice + SWING_PARTIAL_RR[1] * riskPts);
  const targetT3 = target > entryPrice ? target : round2(entryPrice + SWING_PARTIAL_RR[2] * riskPts);

  const sessionDate = sessionDateObj();
  const [allOpen, closedToday] = await Promise.all([
    prisma.paperPosition.findMany({
      where: { userId, status: PaperPositionStatus.open },
    }),
    prisma.paperPosition.findMany({
      where: { userId, status: PaperPositionStatus.closed, sessionDate },
      select: { realizedPnl: true },
    }),
  ]);
  const equity = wallet.cashBalance + wallet.reservedCash;
  const openForRisk = allOpen.map((position) => ({
    symbol: position.symbol,
    entry_price: position.entryPrice,
    stop_loss: position.effectiveStop ?? position.stopLoss,
    shares: position.quantity,
    quantity: position.quantity,
    sector: ((position.evidence as Record<string, unknown> | null) ?? {}).sector,
  }));
  const heat = portfolioHeatPct(
    openForRisk.map((p) => ({
      entry_price: p.entry_price,
      stop_loss: p.stop_loss,
      quantity: p.quantity,
    })),
    equity,
  );
  const sized = sizePaperShares({ entryPrice, stopLoss, equityInr: equity });
  if (sized.shares < 1) return { skipped: true as const, symbol, reason: sized.reason };
  const sector = resolvePositionSector({
    symbol,
    sector: hit.sector ?? hit.sector_key,
  });
  const sectorGate = canOpenSectorConcentration(openForRisk, sector, sized.notional, equity);
  if (!sectorGate.ok) {
    return { skipped: true as const, symbol, reason: sectorGate.reason };
  }
  const gate = canOpenPaperTrade({
    openCount: allOpen.length,
    heatPct: heat,
    newRiskInr: sized.riskInr,
    equityInr: equity,
    cashBalance: wallet.cashBalance,
    notional: sized.notional,
    sessionDayRealizedPnl: closedToday.reduce(
      (total, position) => total + Number(position.realizedPnl ?? 0),
      0,
    ),
  });
  if (!gate.ok) return { skipped: true as const, symbol, reason: gate.reason };

  const clientOrderId = swingOrderId(userId, symbol, snapshotAt);
  const priorOrder = await prisma.paperOrder.findUnique({
    where: { userId_clientOrderId: { userId, clientOrderId } },
  });
  if (priorOrder) return { skipped: true as const, symbol, reason: 'Idempotent order already exists' };

  const feeBreak = estimateFeesBreakdown(sized.notional, { side: 'buy', settlement: 'delivery' });
  const fees = feeBreak.total;
  const equityNow = wallet.cashBalance + wallet.reservedCash;
  const period = await ensureSwingPaperPeriod(userId, equityNow);
  const regimeKey = String(regime?.key ?? hit.regime_key ?? '').trim();
  const regimeLabel = String(regime?.label ?? hit.regime_label ?? '').trim();
  const evidence = {
    source: SWING_PAPER_SOURCE,
    snapshot_at: snapshotAt,
    evaluation_period_id: period.id,
    engine_version: String(hit.engine_version ?? ''),
    decision_score: Number(hit.decision_score ?? 0),
    entry_score: Number(hit.entry_score ?? 0),
    swing_rank: Number(hit.swing_rank ?? 0),
    high_conviction: true,
    strict_verdict: String(hit.strict_verdict ?? ''),
    r_multiple: Number(hit.r_multiple ?? 0),
    r_multiple_ok: hit.r_multiple_ok === true,
    soft_flags: softFlags,
    sector,
    sector_pct_after: sectorGate.sector_after_pct,
    regime_key: regimeKey || null,
    regime_label: regimeLabel || null,
    backtest_grade: String(truth.grade ?? ''),
    backtest_trades: Number(truth.trades_closed ?? 0),
    backtest_win_rate_pct: Number(truth.win_rate_pct ?? 0),
    backtest_profit_factor: Number(truth.profit_factor ?? 0),
    as_of_date: String(hit.as_of_date ?? ''),
    plan_snapshot: {
      entry: entryPrice,
      stop: stopLoss,
      target: targetT3,
      t1: targetT1,
      t2: targetT2,
      t3: targetT3,
      partial_weights: [...SWING_PARTIAL_WEIGHTS],
    },
    exit_profile: 'as_planned',
    fee_breakdown: asJson(feeBreak),
    settlement: 'delivery',
  };

  const position = await prisma.$transaction(async (tx) => {
    const latestWallet = await tx.paperWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    if (latestWallet.cashBalance < sized.notional) throw new Error('Insufficient paper cash at fill');
    const created = await tx.paperPosition.create({
      data: {
        walletId: wallet.id,
        userId,
        instrumentId: `swing:${symbol}`,
        symbol,
        instrumentLabel: symbol,
        side: 'long',
        timeframe: '1d',
        quantity: sized.shares,
        entryPrice,
        entryTime: new Date(),
        sessionDate,
        stopLoss,
        effectiveStop: stopLoss,
        targetT1,
        targetT2,
        targetT3,
        originalQty: sized.shares,
        remainingPct: 100,
        notionalInr: sized.notional,
        reservedCash: sized.notional,
        feesInr: fees,
        evidence,
        source: SWING_PAPER_SOURCE,
      },
    });
    const order = await tx.paperOrder.create({
      data: {
        walletId: wallet.id,
        userId,
        clientOrderId,
        instrumentId: `swing:${symbol}`,
        symbol,
        side: 'long',
        quantity: sized.shares,
        orderType: 'market',
        status: PaperOrderStatus.filled,
        intent: 'open',
        fillPrice: entryPrice,
        filledAt: new Date(),
        positionId: created.id,
        sessionDate,
        evidence,
      },
    });
    await tx.paperFill.create({
      data: { orderId: order.id, price: entryPrice, quantity: sized.shares, feesInr: fees },
    });
    const cashAfter = round2(latestWallet.cashBalance - sized.notional);
    await tx.paperWallet.update({
      where: { id: wallet.id },
      data: {
        cashBalance: cashAfter,
        reservedCash: round2(latestWallet.reservedCash + sized.notional),
      },
    });
    await tx.paperLedgerEntry.create({
      data: {
        walletId: wallet.id,
        type: PaperLedgerType.buy,
        amountInr: -sized.notional,
        balanceAfter: cashAfter,
        refType: 'paper_position',
        refId: created.id,
        meta: { source: SWING_PAPER_SOURCE, symbol, entry_price: entryPrice, risk_inr: sized.riskInr },
      },
    });
    return created;
  });
  return { skipped: false as const, symbol, position: mapSwingPaperPosition(position) };
}

export async function tickSwingPaperUser(userId: string) {
  await ensurePaperWallet(userId);
  const wallet = await prisma.paperWallet.findUniqueOrThrow({
    where: { userId_currency: { userId, currency: PAPER_CURRENCY } },
  });
  if (!(await isSwingPaperArmed(userId))) {
    return { ok: true, skipped: true, reason: 'Swing paper auto not armed' };
  }

  const exits = await manageSwingPaperPositions(userId);
  const notifyExits = () => {
    void notifyTradeSignalEmails(
      userId,
      alertsFromSwingPaperTick({ entries: [], exits }),
    ).catch(() => undefined);
  };

  const session = nseSession();
  if (session.phase !== 'open') {
    notifyExits();
    return { ok: true, skipped: true, reason: `NSE ${session.phase}`, exits, entries: [] };
  }

  const snapshot = await getSwingAutoSnapshotDurable();
  const savedAt = snapshot?.saved_at ?? '';
  const ageSec = savedAt ? Math.floor((Date.now() - Date.parse(savedAt)) / 1000) : Number.POSITIVE_INFINITY;
  if (!snapshot || !Number.isFinite(ageSec) || ageSec > SWING_PAPER_MAX_SNAPSHOT_AGE_SEC) {
    notifyExits();
    return { ok: true, skipped: true, reason: 'Swing Auto snapshot missing or stale', exits, entries: [] };
  }
  const scan = snapshot.scan as Record<string, unknown>;
  const regime =
    (scan.regime as Record<string, unknown> | undefined) ?? (await currentMarketRegime(false));
  if (regime.blocks_strict_enter) {
    notifyExits();
    return { ok: true, skipped: true, reason: 'Strong-bear regime blocks entries', exits, entries: [] };
  }
  const rawHits = Array.isArray(scan.hits) ? (scan.hits as Record<string, unknown>[]) : [];
  const hits = await attachBacktestTruthToHits(await attachFundamentalQualityToHits(rawHits));
  const tiers = categorizeHits(
    hits.filter((hit) => !hit.incremental_stale),
    regime,
    false,
  );
  const candidates = tiers.high_conviction;
  const entries = [];
  let opened = 0;
  for (const candidate of candidates) {
    if (opened >= SWING_PAPER_MAX_ENTRIES_PER_TICK) break;
    const result = await openSwingPaperCandidate(userId, candidate, savedAt, regime);
    entries.push(result);
    if (!result.skipped) opened += 1;
  }
  await prisma.paperWallet.update({
    where: { id: wallet.id },
    data: { lastTickAt: new Date() },
  });
  const payload = { ok: true, skipped: false, session, exits, entries };
  void notifyTradeSignalEmails(userId, alertsFromSwingPaperTick(payload)).catch(() => undefined);
  return payload;
}

export async function tickSwingPaperTrade() {
  const lockToken = await acquireCacheLock(SWING_PAPER_TICK_LOCK, 55);
  if (!lockToken) {
    return { ok: true, wallets: 0, results: [], skipped: true, reason: 'Swing paper tick lock held' };
  }
  try {
    const settings = await prisma.appSetting.findMany({
      where: { key: { startsWith: SWING_PAPER_ARM_PREFIX } },
    });
    const userIds = settings
      .filter((setting) => setting.value === true)
      .map((setting) => setting.key.slice(SWING_PAPER_ARM_PREFIX.length))
      .filter(Boolean);
    const results = [];
    for (const userId of userIds) {
      try {
        results.push({ user_id: userId, ...(await tickSwingPaperUser(userId)) });
      } catch (error) {
        results.push({
          user_id: userId,
          ok: false,
          error: error instanceof Error ? error.message : 'Swing paper tick failed',
        });
      }
    }
    return { ok: true, wallets: userIds.length, results };
  } finally {
    await releaseCacheLock(SWING_PAPER_TICK_LOCK, lockToken);
  }
}
