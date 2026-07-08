import { prisma } from '@sv/db';
import type { Prisma } from '@sv/db';
import { validateThesisInput } from '@sv/core';
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

export async function getWatchlistItemMeta(
  userId: string,
  symbol: string,
): Promise<Record<string, unknown> | null> {
  const watchlist = await getOrCreateDefaultWatchlist(userId);
  const sym = normalizeSymbol(symbol);
  const item = await prisma.watchlistItem.findUnique({
    where: { watchlistId_symbol: { watchlistId: watchlist.id, symbol: sym } },
  });
  if (!item) return null;
  return (item.meta ?? {}) as Record<string, unknown>;
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

export async function syncWatchlistFromFullVerify(
  userId: string,
  symbol: string,
  input: Record<string, string | number | boolean>,
  result: {
    stock_name?: string;
    sector?: string;
    scorecard?: { total?: number };
    metrics?: { margin_of_safety?: number | null };
    verdict?: { action?: string };
  },
): Promise<{ saved: boolean }> {
  const reviewDate = String(input.review_date ?? '').trim();
  if (!reviewDate) return { saved: false };

  const thesis = validateThesisInput(input);
  if (!thesis.watchlist_ready) return { saved: false };

  const sym = normalizeSymbol(symbol);
  const watchlist = await getOrCreateDefaultWatchlist(userId);
  const existing = await prisma.watchlistItem.findUnique({
    where: { watchlistId_symbol: { watchlistId: watchlist.id, symbol: sym } },
  });
  const prevMeta = (existing?.meta ?? {}) as Record<string, unknown>;
  const today = new Date().toISOString().slice(0, 10);

  const meta = {
    ...prevMeta,
    symbol: sym,
    stock_name: String(result.stock_name ?? input.stock_name ?? sym),
    sector: String(result.sector ?? input.sector ?? prevMeta.sector ?? ''),
    review_date: reviewDate,
    thesis_business: String(input.thesis_business ?? ''),
    thesis_financials: String(input.thesis_financials ?? ''),
    thesis_valuation: String(input.thesis_valuation ?? ''),
    invalidation_1: String(input.invalidation_1 ?? ''),
    invalidation_2: String(input.invalidation_2 ?? ''),
    last_verified_at: today,
    last_score: result.scorecard?.total ?? 0,
    last_mos: result.metrics?.margin_of_safety ?? null,
    last_verdict: result.verdict?.action ?? '',
  };

  await prisma.watchlistItem.upsert({
    where: { watchlistId_symbol: { watchlistId: watchlist.id, symbol: sym } },
    create: {
      watchlistId: watchlist.id,
      symbol: sym,
      meta: meta as Prisma.InputJsonValue,
    },
    update: {
      meta: meta as Prisma.InputJsonValue,
    },
  });

  return { saved: true };
}
