import { randomBytes } from 'node:crypto';
import { prisma } from '@sv/db';
import { fetchInstrumentIntradayChart } from '@sv/data-adapters';
import {
  closedTradeMetrics,
  evaluateIntradayPosition,
  isCompatibleMarkPrice,
  normalizeInterval,
  resolveInstrument,
  resolveInstrumentFromSymbol,
  serializeTrackedIntradayPosition,
  sortTrackedPositions,
  summarizeClosedIntradayPositions,
  summarizeOpenIntradayPortfolio,
} from '@sv/intraday';
import type { NiftyIntradayPositionCreateInput, NiftyIntradayPositionUpdateInput } from '@sv/shared';
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
  options: { live?: boolean; date_from?: string; date_to?: string } = {},
) {
  const dateWhere = intradayDateWhere(options.date_from, options.date_to);
  const positions = await prisma.niftyIntradayPosition.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(status ? { status } : {}),
      ...(dateWhere ?? {}),
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

function intradayDateWhere(from?: string, to?: string) {
  const bounds = dateBounds(from, to);
  if (!bounds) return null;
  return { sessionDate: { gte: bounds.start, lt: bounds.endExclusive } };
}

function dateBounds(from?: string, to?: string): { start: Date; endExclusive: Date } | null {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to || from);
  if (!start || !end) return null;
  const endExclusive = new Date(end);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return start <= end ? { start, endExclusive } : { start: end, endExclusive: addUtcDay(start) };
}

function parseDateOnly(v?: string): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addUtcDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + 1);
  return out;
}

export async function createIntradayPosition(userId: string, input: NiftyIntradayPositionCreateInput) {
  const instrument = resolveInstrumentFromSymbol(input.symbol ?? input.instrument_id, input.instrument_id);
  if (!instrument) {
    throw new Error(`Unknown instrument: ${input.instrument_id}`);
  }

  const side = input.side === 'short' ? 'short' : 'long';
  const entry = Number(input.entry_price);
  if (!(entry > 0)) throw new Error('Entry price must be positive.');

  const stop = input.stop_loss != null ? Number(input.stop_loss) : null;
  if (stop != null && stop > 0) {
    if (side === 'long' && stop >= entry) throw new Error('Long stop must be below entry.');
    if (side === 'short' && stop <= entry) throw new Error('Short stop must be above entry.');
  }

  for (const [label, raw] of [
    ['T1', input.target_t1],
    ['T2', input.target_t2],
    ['T3', input.target_t3],
  ] as const) {
    if (raw == null) continue;
    const t = Number(raw);
    if (!(t > 0)) continue;
    if (side === 'long' && t <= entry) throw new Error(`${label} must be above entry for long.`);
    if (side === 'short' && t >= entry) throw new Error(`${label} must be below entry for short.`);
  }

  const entryTime = input.entry_time ? new Date(input.entry_time) : new Date();
  const sessionDate = istSessionDate(entryTime);

  const duplicate = await prisma.niftyIntradayPosition.findFirst({
    where: {
      userId,
      instrumentId: instrument.id,
      status: 'open',
      sessionDate: new Date(sessionDate),
    },
    select: { id: true, entryPrice: true },
  });
  if (duplicate) {
    throw new Error(
      `Open ${instrument.label} position already exists today @ ₹${duplicate.entryPrice}. Close it first or use a different instrument.`,
    );
  }

  const id = randomBytes(8).toString('hex');
  const position = await prisma.niftyIntradayPosition.create({
    data: {
      id,
      userId,
      instrumentId: instrument.id,
      symbol: input.symbol?.toUpperCase() ?? instrument.cache_key,
      instrumentLabel: instrument.label,
      side,
      timeframe: input.timeframe ?? '15m',
      entryPrice: entry,
      entryTime,
      sessionDate: new Date(sessionDate),
      quantity: input.quantity,
      stopLoss: stop && stop > 0 ? stop : null,
      effectiveStop: stop && stop > 0 ? stop : null,
      targetT1: input.target_t1,
      targetT2: input.target_t2,
      targetT3: input.target_t3,
      notes: input.notes,
      source: input.source ?? 'manual',
      highestSinceEntry: entry,
      lowestSinceEntry: entry,
    },
  });

  return { position: mapPosition(position) };
}

export async function updateIntradayPosition(
  userId: string,
  id: string,
  input: NiftyIntradayPositionUpdateInput,
) {
  const existing = await prisma.niftyIntradayPosition.findFirst({
    where: { id, userId, status: 'open' },
  });
  if (!existing) return null;

  const side = existing.side === 'short' ? 'short' : 'long';
  const entry = input.entry_price ?? existing.entryPrice;
  if (!(entry > 0)) throw new Error('Entry price must be positive.');

  const nextStop =
    input.stop_loss === undefined
      ? existing.stopLoss
      : input.stop_loss;

  if (nextStop != null && nextStop > 0) {
    if (side === 'long' && nextStop >= entry) throw new Error('Long stop must be below entry.');
    if (side === 'short' && nextStop <= entry) throw new Error('Short stop must be above entry.');

    // Trail ratchet: never loosen the effective stop once set.
    const prior = existing.effectiveStop ?? existing.stopLoss;
    if (prior != null && prior > 0) {
      if (side === 'long' && nextStop < prior) {
        throw new Error(`Stop cannot be loosened below current effective stop ₹${prior}.`);
      }
      if (side === 'short' && nextStop > prior) {
        throw new Error(`Stop cannot be loosened above current effective stop ₹${prior}.`);
      }
    }
  }

  for (const [label, raw] of [
    ['T1', input.target_t1],
    ['T2', input.target_t2],
    ['T3', input.target_t3],
  ] as const) {
    if (raw === undefined || raw === null) continue;
    if (!(raw > 0)) continue;
    if (side === 'long' && raw <= entry) throw new Error(`${label} must be above entry for long.`);
    if (side === 'short' && raw >= entry) throw new Error(`${label} must be below entry for short.`);
  }

  const position = await prisma.niftyIntradayPosition.update({
    where: { id },
    data: {
      ...(input.entry_price != null ? { entryPrice: input.entry_price } : {}),
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.stop_loss !== undefined
        ? {
            stopLoss: input.stop_loss,
            effectiveStop: input.stop_loss,
          }
        : {}),
      ...(input.target_t1 !== undefined ? { targetT1: input.target_t1 } : {}),
      ...(input.target_t2 !== undefined ? { targetT2: input.target_t2 } : {}),
      ...(input.target_t3 !== undefined ? { targetT3: input.target_t3 } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.t1_booked !== undefined ? { t1Booked: input.t1_booked } : {}),
      ...(input.t2_booked !== undefined ? { t2Booked: input.t2_booked } : {}),
      ...(input.breakeven_armed !== undefined ? { breakevenArmed: input.breakeven_armed } : {}),
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
  if (!isCompatibleMarkPrice(existing.entryPrice, closedPrice)) {
    throw new Error(
      `INCOMPATIBLE_MARK: close ₹${closedPrice} vs entry ₹${existing.entryPrice} (index/ETF mix-up)`,
    );
  }

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

const INTRADAY_CSV_HEADERS = [
  'instrument',
  'symbol',
  'source',
  'side',
  'timeframe',
  'session_date',
  'entry_time',
  'entry_price',
  'quantity',
  'stop_loss',
  'target_t1',
  'target_t2',
  'target_t3',
  'closed_at',
  'closed_price',
  'closed_reason',
  'net_pnl',
  'net_pnl_pct',
  'r_multiple',
  'notes',
] as const;

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Closed-journal CSV — PHP `nifty-positions-export.php` / NP-C4. */
export async function exportIntradayPositionsCsv(
  userId?: string,
  options: { limit?: number; date_from?: string; date_to?: string } = {},
): Promise<string> {
  const limit = Math.max(1, Math.min(500, options.limit ?? 100));
  const dateWhere = intradayDateWhere(options.date_from, options.date_to);
  const positions = await prisma.niftyIntradayPosition.findMany({
    where: {
      status: 'closed',
      ...(userId ? { userId } : {}),
      ...(dateWhere ?? {}),
    },
    orderBy: [{ closedAt: 'desc' }, { entryTime: 'desc' }],
    take: limit,
  });

  const lines = [INTRADAY_CSV_HEADERS.join(',')];
  for (const p of positions) {
    const mapped = mapPosition(p);
    const metrics = closedTradeMetrics(mapped);
    lines.push(
      [
        mapped.instrument_label ?? mapped.instrument_id,
        mapped.symbol,
        mapped.source ?? '',
        mapped.side,
        mapped.timeframe,
        mapped.session_date,
        mapped.entry_time,
        mapped.entry_price,
        mapped.quantity ?? '',
        mapped.stop_loss ?? '',
        mapped.target_t1 ?? '',
        mapped.target_t2 ?? '',
        mapped.target_t3 ?? '',
        mapped.closed_at ?? '',
        mapped.closed_price ?? '',
        mapped.closed_reason ?? '',
        metrics?.net_pnl ?? '',
        metrics?.net_pnl_pct ?? '',
        metrics?.r_multiple ?? '',
        mapped.notes ?? '',
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
