import { randomBytes } from 'node:crypto';
import { prisma } from '@sv/db';
import { fetchInstrumentIntradayChart } from '@sv/data-adapters';
import {
  closedTradeMetrics,
  evaluateIntradayPosition,
  normalizeInterval,
  resolveInstrument,
  resolveInstrumentFromSymbol,
  serializeTrackedIntradayPosition,
  sortTrackedPositions,
  summarizeClosedIntradayPositions,
  summarizeOpenIntradayPortfolio,
} from '@sv/intraday';
import type { NiftyIntradayPositionCreateInput } from '@sv/shared';
import { undoCloseMeta } from '@sv/shared';

function istSessionDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

function mapPosition(p: {
  id: string;
  instrumentId: string;
  symbol: string;
  instrumentLabel: string | null;
  status: string;
  side: string;
  timeframe: string;
  entryPrice: number;
  entryTime: Date;
  sessionDate: Date;
  quantity: number | null;
  stopLoss: number | null;
  effectiveStop: number | null;
  targetT1: number | null;
  targetT2: number | null;
  targetT3: number | null;
  remainingPct: number;
  t1Booked: boolean;
  t2Booked: boolean;
  breakevenArmed: boolean;
  notes: string | null;
  source: string | null;
  closedAt: Date | null;
  closedPrice: number | null;
  closedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const base = {
    id: p.id,
    instrument_id: p.instrumentId,
    symbol: p.symbol,
    instrument_label: p.instrumentLabel,
    status: p.status,
    side: p.side,
    side_label: p.side === 'short' ? 'Short' : 'Long',
    timeframe: p.timeframe,
    entry_price: p.entryPrice,
    entry_time: p.entryTime.toISOString(),
    session_date: p.sessionDate.toISOString().slice(0, 10),
    quantity: p.quantity,
    stop_loss: p.stopLoss,
    effective_stop: p.effectiveStop,
    target_t1: p.targetT1,
    target_t2: p.targetT2,
    target_t3: p.targetT3,
    remaining_pct: p.remainingPct,
    t1_booked: p.t1Booked,
    t2_booked: p.t2Booked,
    breakeven_armed: p.breakevenArmed,
    notes: p.notes,
    source: p.source,
    closed_at: p.closedAt?.toISOString() ?? null,
    closed_price: p.closedPrice,
    closed_reason: p.closedReason,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
  if (p.status === 'closed' && p.closedAt) {
    return { ...base, ...undoCloseMeta(p.closedAt) };
  }
  return { ...base, can_undo: false, undo_seconds_left: 0, undo_until: null };
}

export async function listIntradayPositions(
  userId?: string,
  status?: 'open' | 'closed',
  options: { live?: boolean } = {},
) {
  const positions = await prisma.niftyIntradayPosition.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: [{ status: 'asc' }, { entryTime: 'desc' }],
  });

  const mapped = positions.map(mapPosition);
  const allOpen = positions.filter((p) => p.status === 'open').length;
  const allClosed = positions.filter((p) => p.status === 'closed').length;

  let responsePositions: Record<string, unknown>[] = mapped;
  let liveBlock: Record<string, unknown> | null = null;

  const openRows = mapped.filter((p) => p.status === 'open');
  if (options.live && openRows.length > 0) {
    const tracked = await trackOpenIntradayPositions(openRows, true);
    const serialized = tracked.map(serializeTrackedIntradayPosition);
    liveBlock = {
      refreshed_at: new Date().toISOString(),
      portfolio: summarizeOpenIntradayPortfolio(tracked),
    };

    if (status === 'open') {
      responsePositions = serialized;
    } else if (!status) {
      const closedRows = mapped.filter((p) => p.status === 'closed');
      responsePositions = [...serialized, ...closedRows];
    }
  }

  const closedStats =
    status === 'closed' || !status
      ? summarizeClosedIntradayPositions(mapped.filter((p) => p.status === 'closed'))
      : null;

  return {
    positions: responsePositions,
    summary: { open: allOpen, closed: allClosed },
    live: liveBlock,
    closed_stats: closedStats,
  };
}

export async function createIntradayPosition(userId: string, input: NiftyIntradayPositionCreateInput) {
  const instrument = resolveInstrumentFromSymbol(input.symbol ?? input.instrument_id, input.instrument_id);
  if (!instrument) {
    throw new Error(`Unknown instrument: ${input.instrument_id}`);
  }

  const id = randomBytes(8).toString('hex');
  const entryTime = input.entry_time ? new Date(input.entry_time) : new Date();
  const sessionDate = istSessionDate(entryTime);

  const position = await prisma.niftyIntradayPosition.create({
    data: {
      id,
      userId,
      instrumentId: instrument.id,
      symbol: input.symbol?.toUpperCase() ?? instrument.cache_key,
      instrumentLabel: instrument.label,
      side: input.side ?? 'long',
      timeframe: input.timeframe ?? '15m',
      entryPrice: input.entry_price,
      entryTime,
      sessionDate: new Date(sessionDate),
      quantity: input.quantity,
      stopLoss: input.stop_loss,
      effectiveStop: input.stop_loss,
      targetT1: input.target_t1,
      targetT2: input.target_t2,
      targetT3: input.target_t3,
      notes: input.notes,
      source: input.source ?? 'manual',
      highestSinceEntry: input.entry_price,
      lowestSinceEntry: input.entry_price,
    },
  });

  return { position: mapPosition(position) };
}

export async function closeIntradayPosition(
  userId: string,
  id: string,
  closedPrice: number,
  closedReason?: string,
) {
  const existing = await prisma.niftyIntradayPosition.findFirst({
    where: { id, userId, status: 'open' },
  });
  if (!existing) return null;

  const position = await prisma.niftyIntradayPosition.update({
    where: { id },
    data: {
      status: 'closed',
      closedAt: new Date(),
      closedPrice,
      closedReason: closedReason ?? 'manual',
    },
  });

  const mapped = mapPosition(position);
  return { position: mapped, metrics: closedTradeMetrics(mapped) };
}

export async function reopenIntradayPosition(userId: string, id: string) {
  const existing = await prisma.niftyIntradayPosition.findFirst({
    where: { id, userId, status: 'closed' },
  });
  if (!existing?.closedAt) return null;
  if (!undoCloseMeta(existing.closedAt).can_undo) {
    return { error: 'undo_expired' as const };
  }

  const position = await prisma.niftyIntradayPosition.update({
    where: { id },
    data: {
      status: 'open',
      closedAt: null,
      closedPrice: null,
      closedReason: null,
    },
  });

  return { position: mapPosition(position) };
}

export async function trackOpenIntradayPositions(
  positions: Array<Record<string, unknown>>,
  refresh = false,
) {
  const chartCache = new Map<string, Awaited<ReturnType<typeof fetchInstrumentIntradayChart>>>();
  const rows: Record<string, unknown>[] = [];

  for (const pos of positions) {
    const instrumentId = String(pos.instrument_id ?? '');
    const tf = normalizeInterval(String(pos.timeframe ?? '15m'));
    const chartKey = `${instrumentId}|${tf}`;

    let chart = chartCache.get(chartKey);
    if (chart === undefined) {
      const instrument = resolveInstrument(instrumentId);
      chart = instrument
        ? await fetchInstrumentIntradayChart(
            instrument.cache_key,
            instrument.yahoo_symbols,
            instrument.cache_key,
            tf,
            refresh,
          )
        : null;
      chartCache.set(chartKey, chart);
    }

    rows.push(evaluateIntradayPosition(pos, chart?.bars ?? []));
  }

  return sortTrackedPositions(rows);
}

export { closedTradeMetrics };
