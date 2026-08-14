import { createHash, randomBytes } from 'node:crypto';
import {
  prisma,
  PaperLedgerType,
  PaperOrderStatus,
  PaperPositionStatus,
  PaperWalletStatus,
} from '@sv/db';
import {
  PAPER_CURRENCY,
  PAPER_MAX_OPEN_POSITIONS,
  PAPER_MAX_NOTIONAL_INR,
  PAPER_OPENING_BALANCE_INR,
  PAPER_SOURCE,
  PAPER_STRATEGY_PRESET,
  PAPER_STRATZY_INTERVAL,
  stratzyPaperInstrumentIds,
  analyzeNiftyDirection,
  applySlippage,
  buildLivePlaybook,
  canOpenPaperTrade,
  estimateFeesBreakdown,
  evaluateIntradayPosition,
  evaluatePresets,
  exitProfileFromEvidence,
  gradeSignalQuality,
  mtfConfluence,
  partialWeightForAction,
  portfolioHeatPct,
  remainingPctAfterSale,
  resolveInstrument,
  resolveExitProfile,
  sharesForPartialWeight,
  sizePaperShares,
  summarizePaperProof,
  stratzyPaperEconomicPauseReasons,
  targetsFromProfile,
  isCompatibleMarkPrice,
  TIME_STOP_MIN,
} from '@sv/intraday';
import { nseSession } from '@sv/shared';
import { fetchChartsForInstrument, fetchInstrumentIntradayChart } from './intraday-chart.js';
import { currentMarketRegime } from './market-regime.js';
import { alertsFromIntradayPaperTick, notifyTradeSignalEmails } from './signal-alerts.js';

function istSessionDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

function sessionDateObj(isoDate = istSessionDate()): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function istMinutesFromSession(istTime: string): number {
  const m = istTime.match(/^(\d{2}):(\d{2})/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

async function markPriceForPaperClose(
  pos: { instrumentId: string; timeframe: string; entryPrice: number },
): Promise<number | null> {
  const meta = resolveInstrument(pos.instrumentId);
  if (!meta) return pos.entryPrice;
  const chart = await fetchInstrumentIntradayChart(
    meta.cache_key,
    meta.yahoo_symbols,
    meta.label,
    pos.timeframe === '5m' ? '5m' : '15m',
    true,
  );
  const last = chart?.bars?.[chart.bars.length - 1];
  const px = last?.close != null ? Number(last.close) : pos.entryPrice;
  return isCompatibleMarkPrice(pos.entryPrice, px) ? px : pos.entryPrice;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clientOrderId(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

function mapWallet(w: {
  id: string;
  userId: string;
  currency: string;
  openingBalance: number;
  cashBalance: number;
  reservedCash: number;
  realizedPnl: number;
  status: string;
  autoArmed: boolean;
  lastTickAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: w.id,
    user_id: w.userId,
    currency: w.currency,
    opening_balance: w.openingBalance,
    cash_balance: round2(w.cashBalance),
    reserved_cash: round2(w.reservedCash),
    realized_pnl: round2(w.realizedPnl),
    equity_inr: round2(w.cashBalance + w.reservedCash),
    available_cash: round2(w.cashBalance),
    status: w.status,
    auto_armed: w.autoArmed,
    last_tick_at: w.lastTickAt?.toISOString() ?? null,
    max_notional_inr: PAPER_MAX_NOTIONAL_INR,
    max_open_positions: PAPER_MAX_OPEN_POSITIONS,
    created_at: w.createdAt.toISOString(),
    updated_at: w.updatedAt.toISOString(),
  };
}

function mapPosition(p: {
  id: string;
  instrumentId: string;
  symbol: string;
  instrumentLabel: string | null;
  status: string;
  side: string;
  timeframe: string;
  quantity: number;
  entryPrice: number;
  entryTime: Date;
  sessionDate: Date;
  stopLoss: number | null;
  effectiveStop: number | null;
  targetT1: number | null;
  targetT2: number | null;
  targetT3: number | null;
  remainingPct?: number;
  t1Booked?: boolean;
  t2Booked?: boolean;
  breakevenArmed?: boolean;
  originalQty?: number | null;
  notionalInr: number;
  realizedPnl: number | null;
  feesInr: number;
  closedAt: Date | null;
  closedPrice: number | null;
  closedReason: string | null;
  source: string;
  evidence: unknown;
}) {
  return {
    id: p.id,
    instrument_id: p.instrumentId,
    symbol: p.symbol,
    instrument_label: p.instrumentLabel,
    status: p.status,
    side: p.side,
    timeframe: p.timeframe,
    quantity: p.quantity,
    original_qty: p.originalQty ?? p.quantity,
    entry_price: p.entryPrice,
    entry_time: p.entryTime.toISOString(),
    session_date: p.sessionDate.toISOString().slice(0, 10),
    stop_loss: p.stopLoss,
    effective_stop: p.effectiveStop,
    target_t1: p.targetT1,
    target_t2: p.targetT2,
    target_t3: p.targetT3,
    remaining_pct: p.remainingPct ?? 100,
    t1_booked: Boolean(p.t1Booked),
    t2_booked: Boolean(p.t2Booked),
    breakeven_armed: Boolean(p.breakevenArmed),
    notional_inr: p.notionalInr,
    realized_pnl: p.realizedPnl,
    fees_inr: p.feesInr,
    closed_at: p.closedAt?.toISOString() ?? null,
    closed_price: p.closedPrice,
    closed_reason: p.closedReason,
    source: p.source,
    evidence: p.evidence,
  };
}

/** Live Stratzy index signal for paper — Nifty/BankNifty 15m (matches 60d BT book). */
async function paperStratzyState(instrumentId: string, refresh = true) {
  const meta = resolveInstrument(instrumentId);
  if (!meta || meta.kind !== 'index') return null;
  const { chart5, chart15 } = await fetchChartsForInstrument(meta.cache_key, meta.yahoo_symbols, refresh);
  const analysis5 = analyzeNiftyDirection(chart5, '5m') as Record<string, unknown>;
  const analysis15 = analyzeNiftyDirection(chart15, '15m') as Record<string, unknown>;
  if (analysis5.ok) {
    analysis5.setup_quality = gradeSignalQuality(
      analysis5,
      (analysis5.trade_plan as Record<string, unknown>) ?? {},
      null,
    );
  }
  if (analysis15.ok) {
    analysis15.setup_quality = gradeSignalQuality(
      analysis15,
      (analysis15.trade_plan as Record<string, unknown>) ?? {},
      null,
    );
  }
  const mtf = mtfConfluence(analysis5, analysis15);
  const presetEval = evaluatePresets(
    analysis5,
    analysis15,
    mtf,
    meta ? { ...meta } : null,
    PAPER_STRATZY_INTERVAL,
  );
  const recommendedPreset = PAPER_STRATEGY_PRESET;
  const plan = (analysis15.trade_plan as Record<string, unknown> | null) ?? null;
  const playbook = buildLivePlaybook(
    plan,
    analysis15,
    analysis5,
    mtf,
    presetEval,
    recommendedPreset,
    PAPER_STRATZY_INTERVAL,
    null, // Stratzy paper proof — skip historical accuracy / backtest gate
    analysis15,
  );
  return {
    instrument: meta,
    interval: PAPER_STRATZY_INTERVAL,
    recommended_preset: recommendedPreset,
    strategy_preset: PAPER_STRATEGY_PRESET,
    analysis: analysis15,
    mtf,
    plan,
    playbook,
  };
}

export async function ensurePaperWallet(userId: string) {
  const existing = await prisma.paperWallet.findUnique({
    where: { userId_currency: { userId, currency: PAPER_CURRENCY } },
  });
  if (existing) return mapWallet(existing);

  const created = await prisma.$transaction(async (tx) => {
    const wallet = await tx.paperWallet.create({
      data: {
        userId,
        currency: PAPER_CURRENCY,
        openingBalance: PAPER_OPENING_BALANCE_INR,
        cashBalance: PAPER_OPENING_BALANCE_INR,
        reservedCash: 0,
        realizedPnl: 0,
        status: PaperWalletStatus.active,
        autoArmed: false,
      },
    });
    await tx.paperLedgerEntry.create({
      data: {
        walletId: wallet.id,
        type: PaperLedgerType.funding,
        amountInr: PAPER_OPENING_BALANCE_INR,
        balanceAfter: PAPER_OPENING_BALANCE_INR,
        refType: 'wallet',
        refId: wallet.id,
        meta: { note: 'Test environment seed — ₹1 lakh paper capital' },
      },
    });
    return wallet;
  });
  return mapWallet(created);
}

export async function getPaperWalletState(userId: string) {
  const wallet = await ensurePaperWallet(userId);
  const session = istSessionDate();
  const open = await prisma.paperPosition.findMany({
    where: { userId, status: PaperPositionStatus.open, source: PAPER_SOURCE },
    orderBy: { entryTime: 'desc' },
  });
  const closedToday = await prisma.paperPosition.findMany({
    where: {
      userId,
      status: PaperPositionStatus.closed,
      sessionDate: sessionDateObj(session),
      source: PAPER_SOURCE,
    },
    orderBy: { closedAt: 'desc' },
  });
  const closedAll = await prisma.paperPosition.findMany({
    where: { userId, status: PaperPositionStatus.closed, source: PAPER_SOURCE },
    orderBy: { closedAt: 'desc' },
    take: 200,
  });
  const ledger = await prisma.paperLedgerEntry.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: 'desc' },
    take: 40,
  });
  const equity = wallet.equity_inr;
  const heat = portfolioHeatPct(
    open.map((p) => ({ entry_price: p.entryPrice, stop_loss: p.stopLoss, quantity: p.quantity })),
    equity,
  );
  const dayPnl = round2(closedToday.reduce((s, p) => s + Number(p.realizedPnl ?? 0), 0));
  const proofToday = summarizePaperProof(
    closedToday.map((p) => ({ realized_pnl: p.realizedPnl, evidence: p.evidence, source: p.source })),
  );
  const proofAll = summarizePaperProof(
    closedAll.map((p) => ({ realized_pnl: p.realizedPnl, evidence: p.evidence, source: p.source })),
  );

  return {
    ok: true,
    wallet,
    strategy_preset: PAPER_STRATEGY_PRESET,
    strategy_label: '20 MA Stratzy v2 · Nifty + Bank Nifty 15m',
    strategy_book: stratzyPaperInstrumentIds(),
    open_positions: open.map(mapPosition),
    closed_today: closedToday.map(mapPosition),
    proof: {
      today: proofToday,
      all: proofAll,
      note: proofAll.sample_ok
        ? 'Stratzy index paper ≥5 closes — narrative only until expectancy>0 and PF≥1.25 (auto-pauses new entries after 10 uneconomic closes).'
        : 'Need ≥5 Stratzy index paper closes for a usable proof sample.',
    },
    heat_pct: heat,
    session_date: session,
    session_day_realized_pnl: dayPnl,
    nse: nseSession(),
    ledger: ledger.map((e) => ({
      id: e.id,
      type: e.type,
      amount_inr: e.amountInr,
      balance_after: e.balanceAfter,
      ref_type: e.refType,
      ref_id: e.refId,
      meta: e.meta,
      created_at: e.createdAt.toISOString(),
    })),
  };
}

export async function setPaperAutoArmed(userId: string, armed: boolean) {
  await ensurePaperWallet(userId);
  const wallet = await prisma.paperWallet.update({
    where: { userId_currency: { userId, currency: PAPER_CURRENCY } },
    data: { autoArmed: armed, status: PaperWalletStatus.active },
  });
  return mapWallet(wallet);
}

export async function closePaperPosition(
  userId: string,
  positionId: string,
  closedPrice: number,
  closedReason: string,
) {
  const pos = await prisma.paperPosition.findFirst({
    where: { id: positionId, userId, status: PaperPositionStatus.open },
  });
  if (!pos) return null;
  if (!isCompatibleMarkPrice(pos.entryPrice, closedPrice)) {
    throw new Error(
      `INCOMPATIBLE_MARK: close ₹${closedPrice} vs entry ₹${pos.entryPrice} (index/ETF mix-up)`,
    );
  }

  const side = pos.side === 'short' ? 'short' : 'long';
  const fillPx = applySlippage(closedPrice, side, false);
  const gross =
    side === 'short' ? (pos.entryPrice - fillPx) * pos.quantity : (fillPx - pos.entryPrice) * pos.quantity;
  const settlement = pos.source === 'swing_paper_auto' ? 'delivery' : 'intraday';
  const feeBreak = estimateFeesBreakdown(Math.abs(fillPx * pos.quantity), {
    side: 'sell',
    settlement,
  });
  const fees = feeBreak.total;
  const priorRealized = Number(pos.realizedPnl ?? 0);
  const ev = (pos.evidence ?? {}) as Record<string, unknown>;
  const entryFeesLeft = Number(ev.entry_fees_remaining ?? pos.feesInr ?? 0);
  // Remainder close: exit fees + any unpaid entry fees; add to prior partial PnL.
  const sliceNet = round2(gross - fees - entryFeesLeft);
  const totalRealized = round2(priorRealized + sliceNet);
  const released = round2(pos.reservedCash);

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await tx.paperWallet.findUniqueOrThrow({ where: { id: pos.walletId } });
    const cashAfterRelease = round2(wallet.cashBalance + released + sliceNet);
    const reservedAfter = round2(Math.max(0, wallet.reservedCash - released));

    const updated = await tx.paperPosition.update({
      where: { id: pos.id },
      data: {
        status: PaperPositionStatus.closed,
        closedAt: new Date(),
        closedPrice: fillPx,
        closedReason,
        quantity: 0,
        remainingPct: 0,
        realizedPnl: totalRealized,
        feesInr: round2(pos.feesInr + fees),
        reservedCash: 0,
        evidence: {
          ...ev,
          entry_fees_remaining: 0,
          final_slice: { gross: round2(gross), exit_fees: fees, net: sliceNet },
        },
      },
    });

    const order = await tx.paperOrder.create({
      data: {
        walletId: pos.walletId,
        userId,
        clientOrderId: clientOrderId(['close', pos.id, String(Date.now()), randomBytes(4).toString('hex')]),
        instrumentId: pos.instrumentId,
        symbol: pos.symbol,
        side: pos.side,
        quantity: pos.quantity,
        orderType: 'market',
        status: PaperOrderStatus.filled,
        intent: 'close',
        fillPrice: fillPx,
        filledAt: new Date(),
        positionId: pos.id,
        sessionDate: pos.sessionDate,
        evidence: { reason: closedReason, tier: 'T3_OR_FULL' },
      },
    });
    await tx.paperFill.create({
      data: { orderId: order.id, price: fillPx, quantity: pos.quantity, feesInr: fees },
    });
    await tx.paperWallet.update({
      where: { id: wallet.id },
      data: {
        cashBalance: cashAfterRelease,
        reservedCash: reservedAfter,
        realizedPnl: round2(wallet.realizedPnl + sliceNet),
      },
    });
    await tx.paperLedgerEntry.create({
      data: {
        walletId: wallet.id,
        type: PaperLedgerType.pnl_realize,
        amountInr: sliceNet,
        balanceAfter: cashAfterRelease,
        refType: 'paper_position',
        refId: pos.id,
        meta: {
          fill_price: fillPx,
          exit_fees: fees,
          entry_fees_applied: entryFeesLeft,
          closed_reason: closedReason,
          gross: round2(gross),
          prior_realized: priorRealized,
          total_realized: totalRealized,
        },
      },
    });
    return updated;
  });

  return mapPosition(result);
}

/** Book T1 or T2 partial — reduce size, realize slice PnL, BE stop after T1. */
export async function bookPaperPartial(
  userId: string,
  positionId: string,
  marketPrice: number,
  action: 'PARTIAL_T1' | 'PARTIAL_T2',
) {
  const pos = await prisma.paperPosition.findFirst({
    where: { id: positionId, userId, status: PaperPositionStatus.open },
  });
  if (!pos) return null;
  if (!isCompatibleMarkPrice(pos.entryPrice, marketPrice)) return mapPosition(pos);
  if (action === 'PARTIAL_T1' && pos.t1Booked) return mapPosition(pos);
  if (action === 'PARTIAL_T2' && (pos.t2Booked || !pos.t1Booked)) return mapPosition(pos);

  const profile = exitProfileFromEvidence(pos.evidence);
  const weight = partialWeightForAction(action, profile);
  if (weight == null || weight <= 0) return mapPosition(pos);

  const originalQty = Number(pos.originalQty ?? pos.quantity);
  const sellShares = sharesForPartialWeight(originalQty, pos.quantity, weight);
  if (sellShares <= 0) return mapPosition(pos);

  // If this partial would empty the book, close fully as a target exit — never label a flat as PARTIAL_*.
  if (sellShares >= pos.quantity) {
    return closePaperPosition(userId, positionId, marketPrice, 'EXIT_TARGET');
  }

  const side = pos.side === 'short' ? 'short' : 'long';
  const fillPx = applySlippage(marketPrice, side, false);
  const targetPx =
    action === 'PARTIAL_T1'
      ? Number(pos.targetT1 ?? fillPx)
      : Number(pos.targetT2 ?? fillPx);
  const usePx = targetPx > 0 ? (side === 'long' ? Math.max(fillPx, targetPx) : Math.min(fillPx, targetPx)) : fillPx;

  const gross =
    side === 'short' ? (pos.entryPrice - usePx) * sellShares : (usePx - pos.entryPrice) * sellShares;
  const settlement = pos.source === 'swing_paper_auto' ? 'delivery' : 'intraday';
  const feeBreak = estimateFeesBreakdown(Math.abs(usePx * sellShares), {
    side: 'sell',
    settlement,
  });
  const fees = feeBreak.total;
  const net = round2(gross - fees);
  const openAfter = round2(pos.quantity - sellShares);
  const newRemaining = remainingPctAfterSale(originalQty, openAfter);
  const release = round2(pos.reservedCash * (sellShares / pos.quantity));
  const ev = (pos.evidence ?? {}) as Record<string, unknown>;
  const entryFeesTotal = Number(ev.entry_fees ?? pos.feesInr ?? 0);
  const entryFeesRemaining = Number(ev.entry_fees_remaining ?? entryFeesTotal);
  const entryFeesSlice = round2(entryFeesTotal * (sellShares / originalQty));
  const entryFeesLeft = round2(Math.max(0, entryFeesRemaining - entryFeesSlice));
  const sliceNet = round2(net - entryFeesSlice);

  const beStop = pos.entryPrice;
  const result = await prisma.$transaction(async (tx) => {
    const wallet = await tx.paperWallet.findUniqueOrThrow({ where: { id: pos.walletId } });
    const cashAfter = round2(wallet.cashBalance + release + sliceNet);
    const reservedAfter = round2(Math.max(0, wallet.reservedCash - release));

    const updated = await tx.paperPosition.update({
      where: { id: pos.id },
      data: {
        quantity: openAfter,
        remainingPct: newRemaining,
        reservedCash: round2(Math.max(0, pos.reservedCash - release)),
        notionalInr: round2(pos.entryPrice * openAfter),
        realizedPnl: round2(Number(pos.realizedPnl ?? 0) + sliceNet),
        feesInr: round2(pos.feesInr + fees),
        t1Booked: action === 'PARTIAL_T1' ? true : pos.t1Booked,
        t2Booked: action === 'PARTIAL_T2' ? true : pos.t2Booked,
        breakevenArmed: action === 'PARTIAL_T1' ? true : pos.breakevenArmed,
        effectiveStop:
          action === 'PARTIAL_T1'
            ? side === 'long'
              ? Math.max(pos.effectiveStop ?? beStop, beStop)
              : Math.min(pos.effectiveStop ?? beStop, beStop)
            : pos.effectiveStop,
        evidence: JSON.parse(
          JSON.stringify({
            ...ev,
            exit_profile: profile.id,
            entry_fees: entryFeesTotal,
            entry_fees_remaining: entryFeesLeft,
            partials: [
              ...((Array.isArray(ev.partials) ? ev.partials : []) as Record<string, unknown>[]),
              {
                action,
                shares: sellShares,
                price: usePx,
                gross: round2(gross),
                fees,
                net: sliceNet,
                at: new Date().toISOString(),
              },
            ],
          }),
        ),
      },
    });

    const order = await tx.paperOrder.create({
      data: {
        walletId: pos.walletId,
        userId,
        clientOrderId: clientOrderId([
          'partial',
          action,
          pos.id,
          String(Date.now()),
          randomBytes(4).toString('hex'),
        ]),
        instrumentId: pos.instrumentId,
        symbol: pos.symbol,
        side: pos.side,
        quantity: sellShares,
        orderType: 'market',
        status: PaperOrderStatus.filled,
        intent: action.toLowerCase(),
        fillPrice: usePx,
        filledAt: new Date(),
        positionId: pos.id,
        sessionDate: pos.sessionDate,
        evidence: { action, profile: profile.id, weight },
      },
    });
    await tx.paperFill.create({
      data: { orderId: order.id, price: usePx, quantity: sellShares, feesInr: fees },
    });
    await tx.paperWallet.update({
      where: { id: wallet.id },
      data: {
        cashBalance: cashAfter,
        reservedCash: reservedAfter,
        realizedPnl: round2(wallet.realizedPnl + sliceNet),
      },
    });
    await tx.paperLedgerEntry.create({
      data: {
        walletId: wallet.id,
        type: PaperLedgerType.pnl_realize,
        amountInr: sliceNet,
        balanceAfter: cashAfter,
        refType: 'paper_position',
        refId: pos.id,
        meta: {
          action,
          shares: sellShares,
          fill_price: usePx,
          remaining_pct: newRemaining,
          be_stop: action === 'PARTIAL_T1' ? beStop : null,
        },
      },
    });
    return updated;
  });

  return mapPosition(result);
}

async function openFromSignal(
  userId: string,
  state: NonNullable<Awaited<ReturnType<typeof paperStratzyState>>>,
) {
  const meta = state.instrument;
  const walletRow = await prisma.paperWallet.findUniqueOrThrow({
    where: { userId_currency: { userId, currency: PAPER_CURRENCY } },
  });

  const playbook = state.playbook as Record<string, unknown>;
  if (!playbook?.actionable) return { skipped: true as const, reason: 'Playbook not actionable' };

  const plan = state.plan;
  if (!plan?.ok) return { skipped: true as const, reason: 'No trade plan' };

  const bias = String(plan.bias ?? '');
  if (bias !== 'long' && bias !== 'short') return { skipped: true as const, reason: `Bias ${bias}` };

  const entry = (plan.entry as Record<string, unknown>) ?? {};
  const stop = (plan.stop_loss as Record<string, unknown>) ?? {};
  const exits = (plan.exits as Record<string, unknown>[]) ?? [];
  const rawEntry = Number(entry.price ?? state.analysis?.price ?? 0);
  const stopPx = Number(stop.price ?? 0);
  if (rawEntry <= 0 || stopPx <= 0) return { skipped: true as const, reason: 'Missing entry/stop' };

  const side = bias as 'long' | 'short';
  const fillPx = applySlippage(rawEntry, side, true);
  const session = istSessionDate();
  const sessionDate = sessionDateObj(session);

  const dup = await prisma.paperPosition.findFirst({
    where: { userId, instrumentId: meta.id, sessionDate, status: PaperPositionStatus.open },
  });
  if (dup) return { skipped: true as const, reason: `Already open ${meta.id}` };

  const open = await prisma.paperPosition.findMany({
    where: { userId, status: PaperPositionStatus.open },
  });
  const closedToday = await prisma.paperPosition.findMany({
    where: { userId, status: PaperPositionStatus.closed, sessionDate },
  });
  const dayPnl = closedToday.reduce((s, p) => s + Number(p.realizedPnl ?? 0), 0);
  const equity = walletRow.cashBalance + walletRow.reservedCash;
  const heat = portfolioHeatPct(
    open.map((p) => ({ entry_price: p.entryPrice, stop_loss: p.stopLoss, quantity: p.quantity })),
    equity,
  );

  const sized = sizePaperShares({ entryPrice: fillPx, stopLoss: stopPx, equityInr: equity });
  if (sized.shares < 1) return { skipped: true as const, reason: sized.reason };

  const gate = canOpenPaperTrade({
    openCount: open.length,
    heatPct: heat,
    newRiskInr: sized.riskInr,
    equityInr: equity,
    cashBalance: walletRow.cashBalance,
    notional: sized.notional,
    sessionDayRealizedPnl: dayPnl,
  });
  if (!gate.ok) return { skipped: true as const, reason: gate.reason };

  const indexClosed = await prisma.paperPosition.findMany({
    where: {
      userId,
      status: PaperPositionStatus.closed,
      source: PAPER_SOURCE,
      instrumentId: { in: [...stratzyPaperInstrumentIds()] },
    },
    orderBy: { closedAt: 'desc' },
    take: 200,
  });
  const indexProof = summarizePaperProof(
    indexClosed.map((p) => ({
      realized_pnl: p.realizedPnl,
      notional_inr: p.notionalInr,
      evidence: p.evidence,
      source: p.source,
    })),
  );
  const econPause = stratzyPaperEconomicPauseReasons(indexProof);
  if (econPause.length > 0) {
    return { skipped: true as const, reason: econPause[0] };
  }

  const exitProfile = resolveExitProfile(
    state.recommended_preset === PAPER_STRATEGY_PRESET ? 'stratzy_trend' : 'as_planned',
  );
  const scaledTargets = targetsFromProfile(fillPx, stopPx, side === 'long', exitProfile);
  const t1 = scaledTargets[0] ?? (Number(exits[0]?.price ?? 0) || null);
  const t2 = scaledTargets[1] ?? (Number(exits[1]?.price ?? 0) || null);
  const t3 = scaledTargets[2] ?? (Number(exits[2]?.price ?? 0) || null);
  const feeBreak = estimateFeesBreakdown(sized.notional, { side: 'buy', settlement: 'intraday' });
  const fees = feeBreak.total;
  const coid = clientOrderId([
    'open',
    userId,
    meta.id,
    session,
    state.interval,
    String(Math.floor(fillPx * 100)),
  ]);

  const existingOrder = await prisma.paperOrder.findUnique({
    where: { userId_clientOrderId: { userId, clientOrderId: coid } },
  });
  if (existingOrder) {
    return { skipped: true as const, reason: 'Idempotent — order already exists', order_id: existingOrder.id };
  }

  const regime = await currentMarketRegime(false);
  const evidence = {
    preset: state.recommended_preset,
    exit_profile: exitProfile.id,
    playbook_headline: String(playbook.headline ?? ''),
    bias,
    interval: state.interval,
    instrument_kind: meta.kind,
    book: 'stratzy_index_paper',
    skip_accuracy_gate: true,
    session_date: session,
    mtf_key: String((state.mtf as Record<string, unknown> | null)?.key ?? ''),
    regime_key: String(regime?.key ?? ''),
    regime_label: String(regime?.label ?? ''),
    plan_snapshot: { entry: fillPx, stop: stopPx, t1, t2, t3, book: exitProfile.label },
    fee_breakdown: JSON.parse(JSON.stringify(feeBreak)),
    entry_fees: fees,
    entry_fees_remaining: fees,
    original_quantity: sized.shares,
    settlement: 'intraday',
  };

  const created = await prisma.$transaction(async (tx) => {
    const wallet = await tx.paperWallet.findUniqueOrThrow({ where: { id: walletRow.id } });
    if (wallet.cashBalance < sized.notional) throw new Error('Insufficient cash at fill time');

    const position = await tx.paperPosition.create({
      data: {
        walletId: wallet.id,
        userId,
        instrumentId: meta.id,
        symbol: meta.cache_key,
        instrumentLabel: meta.label,
        side,
        timeframe: state.interval,
        quantity: sized.shares,
        originalQty: sized.shares,
        remainingPct: 100,
        t1Booked: false,
        t2Booked: false,
        breakevenArmed: false,
        entryPrice: fillPx,
        entryTime: new Date(),
        sessionDate,
        stopLoss: stopPx,
        effectiveStop: stopPx,
        targetT1: t1,
        targetT2: t2,
        targetT3: t3,
        notionalInr: sized.notional,
        reservedCash: sized.notional,
        feesInr: fees,
        evidence,
        source: PAPER_SOURCE,
      },
    });

    const order = await tx.paperOrder.create({
      data: {
        walletId: wallet.id,
        userId,
        clientOrderId: coid,
        instrumentId: meta.id,
        symbol: meta.cache_key,
        side,
        quantity: sized.shares,
        orderType: 'market',
        status: PaperOrderStatus.filled,
        intent: 'open',
        fillPrice: fillPx,
        filledAt: new Date(),
        positionId: position.id,
        sessionDate,
        evidence,
      },
    });
    await tx.paperFill.create({
      data: { orderId: order.id, price: fillPx, quantity: sized.shares, feesInr: fees },
    });

    const cashAfter = round2(wallet.cashBalance - sized.notional);
    const reservedAfter = round2(wallet.reservedCash + sized.notional);
    await tx.paperWallet.update({
      where: { id: wallet.id },
      data: { cashBalance: cashAfter, reservedCash: reservedAfter },
    });
    await tx.paperLedgerEntry.create({
      data: {
        walletId: wallet.id,
        type: PaperLedgerType.buy,
        amountInr: -sized.notional,
        balanceAfter: cashAfter,
        refType: 'paper_position',
        refId: position.id,
        meta: { fill_price: fillPx, shares: sized.shares, fees, risk_inr: sized.riskInr },
      },
    });
    return position;
  });

  return { skipped: false as const, position: mapPosition(created) };
}

async function manageOpenPositions(userId: string) {
  const open = await prisma.paperPosition.findMany({
    where: { userId, status: PaperPositionStatus.open, source: PAPER_SOURCE },
  });
  const actions: Array<Record<string, unknown>> = [];
  const chartCache = new Map<string, Awaited<ReturnType<typeof fetchInstrumentIntradayChart>>>();

  for (const pos of open) {
    const meta = resolveInstrument(pos.instrumentId);
    if (!meta) continue;
    const tf = pos.timeframe === '5m' ? '5m' : '15m';
    const key = `${meta.id}|${tf}`;
    let chart = chartCache.get(key);
    if (chart === undefined) {
      chart = await fetchInstrumentIntradayChart(meta.cache_key, meta.yahoo_symbols, meta.label, tf, true);
      chartCache.set(key, chart);
    }
    const profile = exitProfileFromEvidence(pos.evidence);
    const evaluated = evaluateIntradayPosition(
      {
        id: pos.id,
        instrument_id: pos.instrumentId,
        instrument_label: pos.instrumentLabel,
        symbol: pos.symbol,
        side: pos.side,
        timeframe: tf,
        entry_price: pos.entryPrice,
        entry_time: pos.entryTime.toISOString(),
        quantity: pos.quantity,
        stop_loss: pos.stopLoss,
        effective_stop: pos.effectiveStop,
        target_t1: pos.targetT1,
        target_t2: pos.targetT2,
        target_t3: pos.targetT3,
        remaining_pct: pos.remainingPct ?? 100,
        t1_booked: pos.t1Booked,
        t2_booked: pos.t2Booked,
        breakeven_armed: pos.breakevenArmed,
        t1_book_pct: profile.partial_pcts[0],
        t2_book_pct: profile.partial_pcts[1],
      },
      chart?.bars ?? [],
    );

    const action = String(evaluated.position_action ?? 'HOLD');
    const price = Number(evaluated.current_price ?? 0);
    const base = {
      id: pos.id,
      instrument_id: pos.instrumentId,
      symbol: pos.symbol,
      instrument_label: pos.instrumentLabel || meta.label || pos.symbol,
      side: pos.side,
      timeframe: tf,
      quantity: pos.quantity,
      entry_price: pos.entryPrice,
      stop_loss: pos.stopLoss,
      effective_stop: pos.effectiveStop,
      target_t1: pos.targetT1,
      target_t2: pos.targetT2,
      target_t3: pos.targetT3,
      remaining_pct: pos.remainingPct ?? 100,
      t1_booked: pos.t1Booked,
      t2_booked: pos.t2Booked,
      notional_inr: pos.notionalInr,
      realized_pnl: pos.realizedPnl,
      action_label: evaluated.action_label,
    };
    if (price <= 0) {
      actions.push({ ...base, action: 'SKIP', reason: evaluated.error ?? 'No price' });
      continue;
    }
    if (!isCompatibleMarkPrice(pos.entryPrice, price)) {
      actions.push({
        ...base,
        action: 'SKIP',
        reason: `Mark ₹${price} incompatible with entry ₹${pos.entryPrice} (index/ETF mix-up)`,
        price,
      });
      continue;
    }

    if (action === 'PARTIAL_T1' || action === 'PARTIAL_T2') {
      const booked = await bookPaperPartial(userId, pos.id, price, action);
      actions.push({
        ...base,
        action,
        booked: Boolean(booked),
        price,
        remaining_pct: booked?.remaining_pct ?? base.remaining_pct,
        t1_booked: booked?.t1_booked ?? base.t1_booked,
        t2_booked: booked?.t2_booked ?? base.t2_booked,
        realized_pnl: booked?.realized_pnl ?? base.realized_pnl,
      });
      continue;
    }

    if (
      ['EXIT_NOW', 'EXIT_TIME', 'EXIT_TARGET', 'CUT_LOSS'].includes(action) ||
      evaluated.exit_verdict === 'EXIT'
    ) {
      const closed = await closePaperPosition(userId, pos.id, price, action);
      actions.push({
        ...base,
        action,
        closed: Boolean(closed),
        price,
        realized_pnl: closed?.realized_pnl ?? base.realized_pnl,
        closed_reason: closed?.closed_reason ?? action,
      });
    } else {
      actions.push({ ...base, action, price });
    }
  }
  return actions;
}

export async function tickPaperUser(userId: string) {
  const session = nseSession();
  const wallet = await ensurePaperWallet(userId);
  if (!wallet.auto_armed) {
    return { ok: true, skipped: true, reason: 'Auto not armed', wallet };
  }

  const pastTimeStop = istMinutesFromSession(session.ist_time) >= TIME_STOP_MIN;
  if (session.phase !== 'open' || pastTimeStop) {
    const forceClosed: Array<Record<string, unknown>> = [];
    const shouldFlatten = session.phase === 'post' || (session.phase === 'open' && pastTimeStop);
    if (shouldFlatten) {
      const reason = session.phase === 'open' ? 'EXIT_TIME' : 'EXIT_SESSION';
      const open = await prisma.paperPosition.findMany({
        where: { userId, status: PaperPositionStatus.open, source: PAPER_SOURCE },
      });
      for (const pos of open) {
        const meta = resolveInstrument(pos.instrumentId);
        const px = (await markPriceForPaperClose(pos)) ?? pos.entryPrice;
        const closed = await closePaperPosition(userId, pos.id, px, reason);
        forceClosed.push({
          id: pos.id,
          instrument_id: pos.instrumentId,
          symbol: pos.symbol,
          instrument_label: pos.instrumentLabel || meta?.label || pos.symbol,
          side: pos.side,
          timeframe: pos.timeframe,
          quantity: pos.quantity,
          entry_price: pos.entryPrice,
          stop_loss: pos.stopLoss,
          target_t1: pos.targetT1,
          target_t2: pos.targetT2,
          target_t3: pos.targetT3,
          action: reason,
          closed: Boolean(closed),
          price: px,
          realized_pnl: closed?.realized_pnl ?? pos.realizedPnl,
          closed_reason: closed?.closed_reason ?? reason,
        });
      }
      if (forceClosed.length > 0) {
        await prisma.paperWallet.update({
          where: { userId_currency: { userId, currency: PAPER_CURRENCY } },
          data: { lastTickAt: new Date() },
        });
      }
    }
    const stopLabel = pastTimeStop && session.phase === 'open' ? 'time-stop 14:30 IST' : `NSE ${session.phase}`;
    return {
      ok: true,
      skipped: true,
      reason:
        forceClosed.length > 0
          ? `${stopLabel} — force-closed ${forceClosed.length} open position(s)`
          : stopLabel,
      wallet: await ensurePaperWallet(userId),
      session,
      exits: forceClosed,
      entries: [],
    };
  }

  const exits = await manageOpenPositions(userId);
  const entries: Array<Record<string, unknown>> = [];

  for (const id of stratzyPaperInstrumentIds()) {
    try {
      const state = await paperStratzyState(id, true);
      if (!state) {
        entries.push({ instrument: id, skipped: true, reason: 'No state' });
        continue;
      }
      const result = await openFromSignal(userId, state);
      entries.push({ instrument: id, ...result });
    } catch (err) {
      entries.push({ instrument: id, skipped: true, reason: err instanceof Error ? err.message : 'error' });
    }
  }

  await prisma.paperWallet.update({
    where: { userId_currency: { userId, currency: PAPER_CURRENCY } },
    data: { lastTickAt: new Date() },
  });

  const payload = {
    ok: true,
    skipped: false,
    session,
    exits,
    entries,
    wallet: await ensurePaperWallet(userId),
  };
  void notifyTradeSignalEmails(userId, alertsFromIntradayPaperTick(payload)).catch(() => undefined);
  return payload;
}

const VOID_SCALE_REASON = 'VOID_SCALE_MISMATCH';

/** Flatten leftover journal rows whose session is already over (intraday must not overnight). */
export async function flattenOvernightIntradayJournal(todayIso = istSessionDate()) {
  const today = sessionDateObj(todayIso);
  const leftover = await prisma.niftyIntradayPosition.findMany({
    where: { status: 'open', sessionDate: { lt: today } },
  });
  const closed: Array<Record<string, unknown>> = [];
  for (const pos of leftover) {
    const px = (await markPriceForPaperClose(pos)) ?? pos.entryPrice;
    const updated = await prisma.niftyIntradayPosition.update({
      where: { id: pos.id },
      data: {
        status: 'closed',
        closedAt: new Date(),
        closedPrice: px,
        closedReason: 'EXIT_SESSION',
        notes: [pos.notes, `Overnight leftover flattened ${todayIso} @ ₹${px}`].filter(Boolean).join(' · '),
      },
    });
    closed.push({
      id: updated.id,
      symbol: updated.symbol,
      side: updated.side,
      entry_price: updated.entryPrice,
      closed_price: updated.closedPrice,
      session_date: updated.sessionDate.toISOString().slice(0, 10),
      closed_reason: updated.closedReason,
    });
  }
  return { ok: true, flattened: closed.length, positions: closed };
}

/**
 * Void paper closes where the mark was a different instrument scale (NIFTYBEES vs Nifty),
 * reverse wallet PnL via append-only adjustment, and relabel full closes tagged PARTIAL_*.
 */
export async function repairScaleMismatchedPaperCloses() {
  const closed = await prisma.paperPosition.findMany({
    where: { status: PaperPositionStatus.closed, closedPrice: { not: null } },
  });
  const voided: Array<Record<string, unknown>> = [];
  const relabeled: Array<Record<string, unknown>> = [];

  for (const pos of closed) {
    const mark = Number(pos.closedPrice);
    const reason = pos.closedReason ?? '';
    if (reason === VOID_SCALE_REASON) continue;

    if (!isCompatibleMarkPrice(pos.entryPrice, mark)) {
      const corruptPnl = round2(Number(pos.realizedPnl ?? 0));
      const ev = (pos.evidence ?? {}) as Record<string, unknown>;
      await prisma.$transaction(async (tx) => {
        const wallet = await tx.paperWallet.findUniqueOrThrow({ where: { id: pos.walletId } });
        const cashAfter = round2(wallet.cashBalance - corruptPnl);
        await tx.paperWallet.update({
          where: { id: wallet.id },
          data: {
            cashBalance: cashAfter,
            realizedPnl: round2(wallet.realizedPnl - corruptPnl),
          },
        });
        await tx.paperLedgerEntry.create({
          data: {
            walletId: wallet.id,
            type: PaperLedgerType.adjustment,
            amountInr: round2(-corruptPnl),
            balanceAfter: cashAfter,
            refType: 'paper_position',
            refId: pos.id,
            meta: {
              reason: VOID_SCALE_REASON,
              original_closed_price: mark,
              original_closed_reason: reason,
              original_realized_pnl: corruptPnl,
              entry_price: pos.entryPrice,
            },
          },
        });
        await tx.paperPosition.update({
          where: { id: pos.id },
          data: {
            closedPrice: pos.entryPrice,
            realizedPnl: 0,
            closedReason: VOID_SCALE_REASON,
            evidence: {
              ...ev,
              voided_close: {
                closed_price: mark,
                closed_reason: reason,
                realized_pnl: corruptPnl,
                note: 'NIFTYBEES/ETF mark used against index entry — voided to flat at entry',
              },
            },
          },
        });
      });
      voided.push({
        id: pos.id,
        symbol: pos.symbol,
        entry_price: pos.entryPrice,
        voided_mark: mark,
        reversed_pnl: corruptPnl,
      });
      continue;
    }

    if (reason.startsWith('PARTIAL_') && pos.quantity === 0) {
      await prisma.paperPosition.update({
        where: { id: pos.id },
        data: { closedReason: 'EXIT_TARGET' },
      });
      relabeled.push({ id: pos.id, symbol: pos.symbol, from: reason, to: 'EXIT_TARGET' });
    }
  }

  return { ok: true, voided: voided.length, relabeled: relabeled.length, positions: voided, relabeled_ids: relabeled };
}

export async function repairIntradayClosedBooks() {
  const paper = await repairScaleMismatchedPaperCloses();
  const journal = await flattenOvernightIntradayJournal();
  return { ok: true, paper, journal };
}

export async function tickIntradayPaperTrade() {
  const repair = await repairIntradayClosedBooks();
  const armed = await prisma.paperWallet.findMany({
    where: { autoArmed: true, status: PaperWalletStatus.active },
    select: { userId: true },
  });
  const results = [];
  for (const w of armed) {
    try {
      results.push({ user_id: w.userId, ...(await tickPaperUser(w.userId)) });
    } catch (err) {
      results.push({
        user_id: w.userId,
        ok: false,
        error: err instanceof Error ? err.message : 'tick failed',
      });
    }
  }
  return { ok: true, wallets: armed.length, repair, results };
}
