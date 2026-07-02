import { prisma } from '@sv/db';
import type { Prisma } from '@sv/db';
import type { WatchlistUpsertInput } from '@sv/shared';

const DEFAULT_NAME = 'Main';

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '').split('.')[0] ?? '';
}

async function getOrCreateDefaultWatchlist(userId: string) {
  const existing = await prisma.watchlist.findFirst({
    where: { userId, name: DEFAULT_NAME },
    include: { items: { orderBy: { addedAt: 'desc' } } },
  });
  if (existing) return existing;

  return prisma.watchlist.create({
    data: { userId, name: DEFAULT_NAME },
    include: { items: { orderBy: { addedAt: 'desc' } } },
  });
}

export async function listWatchlist(userId: string) {
  const watchlist = await getOrCreateDefaultWatchlist(userId);
  return {
    watchlist: {
      id: watchlist.id,
      name: watchlist.name,
      items: watchlist.items.map((item) => ({
        id: item.id,
        symbol: item.symbol,
        notes: item.notes,
        meta: item.meta,
        addedAt: item.addedAt.toISOString(),
      })),
    },
    summary: summarizeItems(watchlist.items),
  };
}

function summarizeItems(items: { meta: unknown }[]) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  let due = 0;
  let upcoming = 0;

  for (const item of items) {
    const meta = (item.meta ?? {}) as Record<string, unknown>;
    const reviewDate = String(meta.review_date ?? '');
    const rd = reviewDate ? new Date(reviewDate) : null;
    if (!rd || Number.isNaN(rd.getTime())) continue;
    if (rd <= today) due += 1;
    else {
      const days = Math.ceil((rd.getTime() - today.getTime()) / 86400000);
      if (days <= 90) upcoming += 1;
    }
  }

  return { total: items.length, due, upcoming };
}

export async function upsertWatchlistItem(userId: string, input: WatchlistUpsertInput) {
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) throw new Error('Invalid symbol');

  const watchlist = await getOrCreateDefaultWatchlist(userId);
  const item = await prisma.watchlistItem.upsert({
    where: { watchlistId_symbol: { watchlistId: watchlist.id, symbol } },
    create: {
      watchlistId: watchlist.id,
      symbol,
      notes: input.notes,
      meta: (input.meta ?? {}) as Prisma.InputJsonValue,
    },
    update: {
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.meta !== undefined ? { meta: input.meta as Prisma.InputJsonValue } : {}),
    },
  });

  return { item };
}

export async function removeWatchlistItem(userId: string, symbol: string) {
  const watchlist = await getOrCreateDefaultWatchlist(userId);
  const sym = normalizeSymbol(symbol);
  const deleted = await prisma.watchlistItem.deleteMany({
    where: { watchlistId: watchlist.id, symbol: sym },
  });
  return { removed: deleted.count > 0 };
}

export async function syncWatchlistFromVerify(
  userId: string,
  symbol: string,
  snapshot: {
    stock_name?: string;
    sector?: string;
    last_score?: number;
    last_mos?: number;
    last_verdict?: string;
  },
) {
  const sym = normalizeSymbol(symbol);
  const watchlist = await getOrCreateDefaultWatchlist(userId);
  const existing = await prisma.watchlistItem.findUnique({
    where: { watchlistId_symbol: { watchlistId: watchlist.id, symbol: sym } },
  });
  const prevMeta = (existing?.meta ?? {}) as Record<string, unknown>;

  await prisma.watchlistItem.upsert({
    where: { watchlistId_symbol: { watchlistId: watchlist.id, symbol: sym } },
    create: {
      watchlistId: watchlist.id,
      symbol: sym,
      meta: {
        stock_name: snapshot.stock_name ?? sym,
        sector: snapshot.sector ?? '',
        last_verified_at: new Date().toISOString().slice(0, 10),
        last_score: snapshot.last_score ?? 0,
        last_mos: snapshot.last_mos ?? 0,
        last_verdict: snapshot.last_verdict ?? '',
      } as Prisma.InputJsonValue,
    },
    update: {
      meta: {
        ...prevMeta,
        stock_name: snapshot.stock_name ?? prevMeta.stock_name ?? sym,
        sector: snapshot.sector ?? prevMeta.sector ?? '',
        last_verified_at: new Date().toISOString().slice(0, 10),
        last_score: snapshot.last_score ?? prevMeta.last_score ?? 0,
        last_mos: snapshot.last_mos ?? prevMeta.last_mos ?? 0,
        last_verdict: snapshot.last_verdict ?? prevMeta.last_verdict ?? '',
      } as Prisma.InputJsonValue,
    },
  });
}
