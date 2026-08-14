/**
 * Unrestricted Stratzy / swing paper export for offline analysis.
 * No period caps, no take limits, no sample gates — full DB slice.
 */
import { prisma } from '@sv/db';
import {
  PAPER_SOURCE,
  PAPER_STRATEGY_PRESET,
  summarizePaperProof,
} from '@sv/intraday';
import { SWING_PAPER_SOURCE } from './swing-paper-trader.js';

export const INTRADAY_STRATZY_SOURCE = PAPER_SOURCE;
export const INTRADAY_STRATZY_PRESET = PAPER_STRATEGY_PRESET;

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function mapPositionRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    user_id: row.userId,
    wallet_id: row.walletId,
    instrument_id: row.instrumentId,
    symbol: row.symbol,
    instrument_label: row.instrumentLabel,
    status: row.status,
    side: row.side,
    timeframe: row.timeframe,
    quantity: row.quantity,
    original_qty: row.originalQty,
    remaining_pct: row.remainingPct,
    t1_booked: row.t1Booked,
    t2_booked: row.t2Booked,
    breakeven_armed: row.breakevenArmed,
    entry_price: row.entryPrice,
    entry_time: iso(row.entryTime as Date),
    session_date: iso(row.sessionDate as Date),
    stop_loss: row.stopLoss,
    effective_stop: row.effectiveStop,
    target_t1: row.targetT1,
    target_t2: row.targetT2,
    target_t3: row.targetT3,
    notional_inr: row.notionalInr,
    reserved_cash: row.reservedCash,
    realized_pnl: row.realizedPnl,
    fees_inr: row.feesInr,
    closed_at: iso(row.closedAt as Date | null),
    closed_price: row.closedPrice,
    closed_reason: row.closedReason,
    source: row.source,
    evidence: jsonClone(row.evidence),
    created_at: iso(row.createdAt as Date),
    updated_at: iso(row.updatedAt as Date),
  };
}

export function isIntradayStratzyPosition(source: string, evidence: unknown): boolean {
  if (source === INTRADAY_STRATZY_SOURCE) return true;
  const ev = evidence as { preset?: string; exit_profile?: string } | null;
  return ev?.preset === INTRADAY_STRATZY_PRESET || ev?.exit_profile === 'stratzy_trend';
}

export function isSwingPaperPosition(source: string): boolean {
  return source === SWING_PAPER_SOURCE;
}

async function readSwingPaperArchives(userId: string): Promise<unknown[]> {
  const row = await prisma.appSetting.findUnique({
    where: { key: `swing_paper_archives:${userId}` },
  });
  if (!row?.value || !Array.isArray(row.value)) return [];
  return row.value as unknown[];
}

async function readSwingPaperPeriod(userId: string): Promise<unknown | null> {
  const row = await prisma.appSetting.findUnique({
    where: { key: `swing_paper_period:${userId}` },
  });
  return row?.value ?? null;
}

async function readSwingPaperArmed(userId: string): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({
    where: { key: `swing_paper_auto:${userId}` },
  });
  return row?.value === true;
}

export interface StratzyPaperExportOptions {
  /** Limit to one user; default = all users with any paper wallet. */
  userId?: string;
  /** Include raw orders + fills (can be large). Default true. */
  includeOrders?: boolean;
  /** Include full ledger. Default true. */
  includeLedger?: boolean;
}

export interface StratzyPaperUserExport {
  user_id: string;
  email: string | null;
  wallet: Record<string, unknown> | null;
  swing_paper_armed: boolean;
  swing_paper_period: unknown;
  swing_paper_archives: unknown[];
  intraday_stratzy: {
    open: ReturnType<typeof mapPositionRow>[];
    closed: ReturnType<typeof mapPositionRow>[];
    all: ReturnType<typeof mapPositionRow>[];
    proof_all_closed: ReturnType<typeof summarizePaperProof>;
    proof_open_count: number;
  };
  swing_paper: {
    open: ReturnType<typeof mapPositionRow>[];
    closed: ReturnType<typeof mapPositionRow>[];
    all: ReturnType<typeof mapPositionRow>[];
    proof_all_closed: ReturnType<typeof summarizePaperProof>;
    proof_open_count: number;
  };
  orders?: Array<Record<string, unknown>>;
  fills?: Array<Record<string, unknown>>;
  ledger?: Array<Record<string, unknown>>;
}

export interface StratzyPaperExportBundle {
  exported_at: string;
  restrictions: 'none — full DB export for analysis';
  intraday_source: typeof INTRADAY_STRATZY_SOURCE;
  intraday_preset: typeof INTRADAY_STRATZY_PRESET;
  swing_source: typeof SWING_PAPER_SOURCE;
  users: StratzyPaperUserExport[];
  totals: {
    intraday_stratzy_positions: number;
    intraday_stratzy_closed: number;
    swing_paper_positions: number;
    swing_paper_closed: number;
    orders: number;
    fills: number;
    ledger_entries: number;
  };
}

export async function collectStratzyPaperData(
  options: StratzyPaperExportOptions = {},
): Promise<StratzyPaperExportBundle> {
  const includeOrders = options.includeOrders !== false;
  const includeLedger = options.includeLedger !== false;

  const wallets = await prisma.paperWallet.findMany({
    where: options.userId ? { userId: options.userId } : undefined,
    include: { user: { select: { id: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const users: StratzyPaperUserExport[] = [];
  let totalOrders = 0;
  let totalFills = 0;
  let totalLedger = 0;
  let totalIntraday = 0;
  let totalIntradayClosed = 0;
  let totalSwing = 0;
  let totalSwingClosed = 0;

  for (const wallet of wallets) {
    const userId = wallet.userId;
    const allPositions = await prisma.paperPosition.findMany({
      where: { userId },
      orderBy: [{ entryTime: 'asc' }],
    });

    const intradayAll = allPositions.filter((p) =>
      isIntradayStratzyPosition(p.source, p.evidence),
    );
    const swingAll = allPositions.filter((p) => isSwingPaperPosition(p.source));

    const intradayOpen = intradayAll.filter((p) => p.status === 'open');
    const intradayClosed = intradayAll.filter((p) => p.status === 'closed');
    const swingOpen = swingAll.filter((p) => p.status === 'open');
    const swingClosed = swingAll.filter((p) => p.status === 'closed');

    const positionIds = [...intradayAll, ...swingAll].map((p) => p.id);

    let orders: Array<Record<string, unknown>> | undefined;
    let fills: Array<Record<string, unknown>> | undefined;
    if (includeOrders && positionIds.length > 0) {
      const orderRows = await prisma.paperOrder.findMany({
        where: { userId, positionId: { in: positionIds } },
        orderBy: { createdAt: 'asc' },
        include: { fills: true },
      });
      orders = orderRows.map((o) => ({
        id: o.id,
        position_id: o.positionId,
        client_order_id: o.clientOrderId,
        instrument_id: o.instrumentId,
        symbol: o.symbol,
        side: o.side,
        quantity: o.quantity,
        order_type: o.orderType,
        status: o.status,
        intent: o.intent,
        fill_price: o.fillPrice,
        filled_at: iso(o.filledAt),
        reject_reason: o.rejectReason,
        session_date: iso(o.sessionDate),
        evidence: jsonClone(o.evidence),
        created_at: iso(o.createdAt),
      }));
      fills = orderRows.flatMap((o) =>
        o.fills.map((f) => ({
          id: f.id,
          order_id: f.orderId,
          position_id: o.positionId,
          price: f.price,
          quantity: f.quantity,
          fees_inr: f.feesInr,
          created_at: iso(f.createdAt),
        })),
      );
      totalOrders += orders.length;
      totalFills += fills.length;
    }

    let ledger: Array<Record<string, unknown>> | undefined;
    if (includeLedger) {
      const ledgerRows = await prisma.paperLedgerEntry.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'asc' },
      });
      ledger = ledgerRows.map((e) => ({
        id: e.id,
        type: e.type,
        amount_inr: e.amountInr,
        balance_after: e.balanceAfter,
        ref_type: e.refType,
        ref_id: e.refId,
        meta: jsonClone(e.meta),
        created_at: iso(e.createdAt),
      }));
      totalLedger += ledger.length;
    }

    totalIntraday += intradayAll.length;
    totalIntradayClosed += intradayClosed.length;
    totalSwing += swingAll.length;
    totalSwingClosed += swingClosed.length;

    users.push({
      user_id: userId,
      email: wallet.user?.email ?? null,
      wallet: {
        id: wallet.id,
        currency: wallet.currency,
        opening_balance: wallet.openingBalance,
        cash_balance: wallet.cashBalance,
        reserved_cash: wallet.reservedCash,
        realized_pnl: wallet.realizedPnl,
        auto_armed: wallet.autoArmed,
        status: wallet.status,
        last_tick_at: iso(wallet.lastTickAt),
        created_at: iso(wallet.createdAt),
      },
      swing_paper_armed: await readSwingPaperArmed(userId),
      swing_paper_period: await readSwingPaperPeriod(userId),
      swing_paper_archives: await readSwingPaperArchives(userId),
      intraday_stratzy: {
        open: intradayOpen.map(mapPositionRow),
        closed: intradayClosed.map(mapPositionRow),
        all: intradayAll.map(mapPositionRow),
        proof_all_closed: summarizePaperProof(
          intradayClosed.map((p) => ({
            realized_pnl: p.realizedPnl,
            evidence: p.evidence,
            source: p.source,
            notional_inr: p.notionalInr,
          })),
        ),
        proof_open_count: intradayOpen.length,
      },
      swing_paper: {
        open: swingOpen.map(mapPositionRow),
        closed: swingClosed.map(mapPositionRow),
        all: swingAll.map(mapPositionRow),
        proof_all_closed: summarizePaperProof(
          swingClosed.map((p) => ({
            realized_pnl: p.realizedPnl,
            evidence: p.evidence,
            source: p.source,
            notional_inr: p.notionalInr,
          })),
        ),
        proof_open_count: swingOpen.length,
      },
      orders,
      fills,
      ledger,
    });
  }

  return {
    exported_at: new Date().toISOString(),
    restrictions: 'none — full DB export for analysis',
    intraday_source: INTRADAY_STRATZY_SOURCE,
    intraday_preset: INTRADAY_STRATZY_PRESET,
    swing_source: SWING_PAPER_SOURCE,
    users,
    totals: {
      intraday_stratzy_positions: totalIntraday,
      intraday_stratzy_closed: totalIntradayClosed,
      swing_paper_positions: totalSwing,
      swing_paper_closed: totalSwingClosed,
      orders: totalOrders,
      fills: totalFills,
      ledger_entries: totalLedger,
    },
  };
}

/** Flat CSV-friendly rows for closed Stratzy intraday + swing paper trades. */
export function flattenClosedTradesForAnalysis(bundle: StratzyPaperExportBundle) {
  const rows: Array<Record<string, unknown>> = [];
  for (const user of bundle.users) {
    for (const book of ['intraday_stratzy', 'swing_paper'] as const) {
      const section = user[book];
      for (const p of section.closed) {
        const ev = (p.evidence ?? {}) as Record<string, unknown>;
        rows.push({
          book,
          user_id: user.user_id,
          email: user.email,
          symbol: p.symbol,
          instrument_id: p.instrument_id,
          timeframe: p.timeframe,
          side: p.side,
          entry_time: p.entry_time,
          entry_price: p.entry_price,
          exit_time: p.closed_at,
          exit_price: p.closed_price,
          exit_reason: p.closed_reason,
          quantity: p.quantity,
          notional_inr: p.notional_inr,
          realized_pnl_inr: p.realized_pnl,
          fees_inr: p.fees_inr,
          stop_loss: p.stop_loss,
          target_t1: p.target_t1,
          target_t2: p.target_t2,
          target_t3: p.target_t3,
          t1_booked: p.t1_booked,
          t2_booked: p.t2_booked,
          remaining_pct_at_close: p.remaining_pct,
          preset: ev.preset ?? null,
          exit_profile: ev.exit_profile ?? null,
          regime_key: ev.regime_key ?? null,
          interval: ev.interval ?? null,
          decision_score: ev.decision_score ?? null,
          backtest_grade: ev.backtest_grade ?? null,
          backtest_win_rate_pct: ev.backtest_win_rate_pct ?? null,
          position_id: p.id,
        });
      }
    }
  }
  return rows;
}

export function tradesToCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}
