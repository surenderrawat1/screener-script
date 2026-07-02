import { randomBytes } from 'node:crypto';
import { prisma } from '@sv/db';
import type { SwingPositionCreateInput } from '@sv/shared';
import { normalizeSymbol } from './watchlist.js';

export async function listSwingPositions(userId?: string, status?: 'open' | 'closed') {
  const positions = await prisma.swingPosition.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: [{ status: 'asc' }, { entryDate: 'desc' }],
  });

  return {
    positions: positions.map(mapPosition),
    summary: {
      open: positions.filter((p) => p.status === 'open').length,
      closed: positions.filter((p) => p.status === 'closed').length,
    },
  };
}

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
  return {
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

  return { position: mapPosition(position) };
}
