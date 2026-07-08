import { randomBytes } from 'node:crypto';
import { prisma } from '@sv/db';
import {
  buildPositionsBlock,
  summarizeClosedSwingPositions,
  computeTradePnl,
} from '@sv/swing';
import type { SwingPositionCreateInput, SwingPositionUpdateInput } from '@sv/shared';
import { undoCloseMeta } from '@sv/shared';
import { nseSession } from '@sv/shared';
import { refreshOpenPositions } from './swing-auto.js';
import { normalizeSymbol } from './watchlist.js';
import { getSwingAutoSnapshotDurable, currentMarketRegime } from '@sv/data-adapters';

function mapPosition(p: {
  id: string;
  symbol: string;
  status: string;
  entryPrice: number;
  entryDate: Date;
  shares: number | null;
  stopLoss: number | null;
  profitTarget: number | null;
  notes: string | null;
  highestSinceEntry: number | null;
  trailedStopLoss: number | null;
  closedAt: Date | null;
  closedPrice: number | null;
  closedReason: string | null;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const base = {
    id: p.id,
    symbol: p.symbol,
    status: p.status,
    entry_price: p.entryPrice,
    entry_date: p.entryDate.toISOString().slice(0, 10),
    shares: p.shares,
    stop_loss: p.stopLoss,
    profit_target: p.profitTarget,
    notes: p.notes,
    highest_since_entry: p.highestSinceEntry,
    trailed_stop_loss: p.trailedStopLoss,
    closed_at: p.closedAt?.toISOString() ?? null,
    closed_price: p.closedPrice,
    closed_reason: p.closedReason,
    source: p.source,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
  if (p.status === 'closed' && p.closedPrice != null && p.entryPrice > 0) {
    const shares = p.shares ?? 1;
    if (shares > 0) {
      const pnl = computeTradePnl(p.entryPrice, p.closedPrice, shares);
      return {
        ...base,
        gross_pnl: pnl.gross_pnl,
        net_pnl: pnl.net_pnl,
        pnl_detail: pnl.charges,
        ...undoCloseMeta(p.closedAt!),
      };
    }
  }
  if (p.status === 'closed' && p.closedAt) {
    return { ...base, ...undoCloseMeta(p.closedAt) };
  }
  return { ...base, can_undo: false, undo_seconds_left: 0, undo_until: null };
}

export async function listSwingPositions(
  userId?: string,
  status?: 'open' | 'closed',
  options: { live?: boolean; date_from?: string; date_to?: string } = {},
) {
  const dateWhere = swingDateWhere(status, options.date_from, options.date_to);
  const positions = await prisma.swingPosition.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(status ? { status } : {}),
      ...(dateWhere ?? {}),
    },
    orderBy: [{ status: 'asc' }, { entryDate: 'desc' }],
  });

  const mapped = positions.map(mapPosition);
  const allOpen = positions.filter((p) => p.status === 'open').length;
  const allClosed = positions.filter((p) => p.status === 'closed').length;

  let responsePositions: Record<string, unknown>[] = mapped;
  let liveBlock: Record<string, unknown> | null = null;

  const openRows = mapped.filter((p) => p.status === 'open');
  if (options.live && openRows.length > 0) {
    const snapshot = await getSwingAutoSnapshotDurable();
    const scanResult = (snapshot?.scan ?? {}) as Record<string, unknown>;
    const regime = (scanResult.regime as Record<string, unknown> | undefined) ?? (await currentMarketRegime(false));
    const hits = Array.isArray(scanResult.hits) ? (scanResult.hits as Record<string, unknown>[]) : [];
    const refreshed = await refreshOpenPositions(openRows, true, regime);
    const block = buildPositionsBlock(refreshed, hits, regime);
    liveBlock = {
      refreshed_at: block.refreshed_at,
      portfolio: block.portfolio,
      exit_count: block.exit_count,
      urgent_count: block.urgent_count,
      heat_pct: block.heat_pct,
    };

    if (status === 'open') {
      responsePositions = block.open;
    } else if (!status) {
      const closedRows = mapped.filter((p) => p.status === 'closed');
      responsePositions = [...block.open, ...closedRows];
    }
  }

  const closedStats =
    status === 'closed' || !status
      ? summarizeClosedSwingPositions(mapped.filter((p) => p.status === 'closed'))
      : null;

  return {
    positions: responsePositions,
    summary: { open: allOpen, closed: allClosed },
    live: liveBlock,
    closed_stats: closedStats,
    session: nseSession(),
  };
}

function swingDateWhere(status: 'open' | 'closed' | undefined, from?: string, to?: string) {
  const bounds = dateBounds(from, to);
  if (!bounds) return null;
  const range = { gte: bounds.start, lt: bounds.endExclusive };
  if (status === 'open') return null;
  if (status === 'closed') return { closedAt: range };
  return { OR: [{ status: 'open' as const }, { closedAt: range }] };
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

export async function createSwingPosition(userId: string, input: SwingPositionCreateInput) {
  const symbol = normalizeSymbol(input.symbol);
  const id = randomBytes(8).toString('hex');

  const position = await prisma.swingPosition.create({
    data: {
      id,
      userId,
      symbol,
      entryPrice: input.entry_price,
      entryDate: new Date(input.entry_date),
      shares: input.shares,
      stopLoss: input.stop_loss,
      profitTarget: input.profit_target,
      notes: input.notes,
      source: input.source ?? 'manual',
      highestSinceEntry: input.entry_price,
    },
  });

  return { position: mapPosition(position) };
}

export async function closeSwingPosition(
  userId: string,
  id: string,
  closedPrice: number,
  closedReason?: string,
) {
  const existing = await prisma.swingPosition.findFirst({
    where: { id, userId, status: 'open' },
  });
  if (!existing) return null;

  const position = await prisma.swingPosition.update({
    where: { id },
    data: {
      status: 'closed',
      closedAt: new Date(),
      closedPrice,
      closedReason: closedReason ?? 'manual',
    },
  });

  const mapped = mapPosition(position);
  const shares = mapped.shares ?? 1;
  const pnl = computeTradePnl(mapped.entry_price, closedPrice, shares);

  return {
    position: mapped,
    metrics: { gross_pnl: pnl.gross_pnl, net_pnl: pnl.net_pnl, charges: pnl.charges },
  };
}

export async function reopenSwingPosition(userId: string, id: string) {
  const existing = await prisma.swingPosition.findFirst({
    where: { id, userId, status: 'closed' },
  });
  if (!existing?.closedAt) return null;
  if (!undoCloseMeta(existing.closedAt).can_undo) {
    return { error: 'undo_expired' as const };
  }

  const position = await prisma.swingPosition.update({
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

export async function persistPositionTrailRatchet(
  id: string,
  fields: { highest_since_entry?: number; trailed_stop_loss?: number },
) {
  const data: { highestSinceEntry?: number; trailedStopLoss?: number } = {};
  if (fields.highest_since_entry != null) data.highestSinceEntry = fields.highest_since_entry;
  if (fields.trailed_stop_loss != null) data.trailedStopLoss = fields.trailed_stop_loss;
  if (Object.keys(data).length === 0) return;
  await prisma.swingPosition.update({ where: { id }, data });
}

const CSV_HEADERS = [
  'symbol',
  'status',
  'entry_date',
  'entry_price',
  'shares',
  'stop_loss',
  'profit_target',
  'highest_since_entry',
  'trailed_stop_loss',
  'closed_at',
  'closed_price',
  'closed_reason',
  'source',
  'notes',
] as const;

function csvEscape(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function exportSwingPositionsCsv(userId?: string): Promise<string> {
  const positions = await prisma.swingPosition.findMany({
    where: userId ? { userId } : {},
    orderBy: [{ status: 'asc' }, { entryDate: 'desc' }],
  });

  const lines = [CSV_HEADERS.join(',')];
  for (const p of positions) {
    lines.push(
      [
        p.symbol,
        p.status,
        p.entryDate.toISOString().slice(0, 10),
        p.entryPrice,
        p.shares ?? '',
        p.stopLoss ?? '',
        p.profitTarget ?? '',
        p.highestSinceEntry ?? '',
        p.trailedStopLoss ?? '',
        p.closedAt?.toISOString() ?? '',
        p.closedPrice ?? '',
        p.closedReason ?? '',
        p.source ?? '',
        p.notes ?? '',
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return lines.join('\n');
}

export async function listSwingPositionsLive(userId?: string) {
  const positions = await prisma.swingPosition.findMany({
    where: {
      ...(userId ? { userId } : {}),
      status: 'open',
    },
    orderBy: { entryDate: 'desc' },
  });

  const mapped = positions.map(mapPosition);
  if (mapped.length === 0) {
    return { positions: [], refreshed_at: new Date().toISOString(), exit_count: 0, urgent_count: 0 };
  }

  const snapshot = await getSwingAutoSnapshotDurable();
  const scanResult = (snapshot?.scan ?? {}) as Record<string, unknown>;
  const regime = (scanResult.regime as Record<string, unknown> | undefined) ?? (await currentMarketRegime(false));
  const hits = Array.isArray(scanResult.hits) ? (scanResult.hits as Record<string, unknown>[]) : [];
  const refreshed = await refreshOpenPositions(mapped, true, regime);
  const block = buildPositionsBlock(refreshed, hits, regime);

  return {
    positions: block.open,
    refreshed_at: block.refreshed_at,
    exit_count: block.exit_count,
    urgent_count: block.urgent_count,
    portfolio: block.portfolio,
    heat_pct: block.heat_pct,
  };
}

export async function updateSwingPosition(userId: string, id: string, input: SwingPositionUpdateInput) {
  const existing = await prisma.swingPosition.findFirst({
    where: { id, userId },
  });
  if (!existing) return null;

  const position = await prisma.swingPosition.update({
    where: { id },
    data: {
      ...(input.entry_price != null ? { entryPrice: input.entry_price } : {}),
      ...(input.entry_date != null ? { entryDate: new Date(input.entry_date) } : {}),
      ...(input.shares !== undefined ? { shares: input.shares } : {}),
      ...(input.stop_loss !== undefined ? { stopLoss: input.stop_loss } : {}),
      ...(input.profit_target !== undefined ? { profitTarget: input.profit_target } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });

  return { position: mapPosition(position) };
}

export async function deleteSwingPosition(userId: string, id: string) {
  const existing = await prisma.swingPosition.findFirst({
    where: { id, userId },
  });
  if (!existing) return null;
  await prisma.swingPosition.delete({ where: { id } });
  return { ok: true, id };
}
