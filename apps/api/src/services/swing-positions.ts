import { randomBytes } from 'node:crypto';
import { prisma } from '@sv/db';
import {
  buildPositionsBlock,
  summarizeClosedSwingPositions,
} from '@sv/swing';
import type { SwingPositionCreateInput } from '@sv/shared';
import { undoCloseMeta } from '@sv/shared';
import { refreshOpenPositions } from './swing-auto.js';
import { normalizeSymbol } from './watchlist.js';

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
  if (p.status === 'closed' && p.closedAt) {
    return { ...base, ...undoCloseMeta(p.closedAt) };
  }
  return { ...base, can_undo: false, undo_seconds_left: 0, undo_until: null };
}

export async function listSwingPositions(
  userId?: string,
  status?: 'open' | 'closed',
  options: { live?: boolean } = {},
) {
  const positions = await prisma.swingPosition.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(status ? { status } : {}),
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
    const refreshed = await refreshOpenPositions(openRows, true);
    const block = buildPositionsBlock(refreshed, [], null);
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
  };
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
  const entry = mapped.entry_price;
  const shares = mapped.shares ?? 1;
  const netPnl = Math.round((closedPrice - entry) * shares * 100) / 100;

  return {
    position: mapped,
    metrics: { net_pnl: netPnl },
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
