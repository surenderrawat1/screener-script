import { prisma } from '@sv/db';
import { BUILTIN_UNIVERSES } from '@sv/shared';
import { resolveUniverseSymbols } from '@sv/data-adapters';

export { resolveUniverseSymbols };

const DEFAULT_SYMBOLS: Record<string, string[]> = {
  nifty50: ['TCS', 'INFY', 'RELIANCE', 'HDFCBANK', 'ITC', 'BHARTIARTL', 'ICICIBANK', 'SBIN', 'LT', 'AXISBANK'],
  nifty100: ['TCS', 'INFY', 'RELIANCE', 'HDFCBANK', 'ITC', 'WIPRO', 'HCLTECH', 'MARUTI', 'SUNPHARMA', 'TITAN'],
  nifty500: ['TCS', 'INFY', 'RELIANCE', 'HDFCBANK', 'ITC', 'BAJFINANCE', 'ASIANPAINT', 'NESTLEIND', 'ULTRACEMCO', 'POWERGRID'],
};

export async function listUniverses() {
  const dbUniverses = await prisma.universe.findMany({
    include: { _count: { select: { symbols: true } } },
    orderBy: { name: 'asc' },
  });

  if (dbUniverses.length === 0) {
    return BUILTIN_UNIVERSES.map((u) => ({
      key: u.key,
      name: u.name,
      type: 'builtin',
      symbolCount: DEFAULT_SYMBOLS[u.key]?.length ?? 0,
    }));
  }

  return dbUniverses.map((u) => ({
    id: u.id,
    key: u.key,
    name: u.name,
    type: u.type,
    symbolCount: u._count.symbols,
  }));
}

export async function createCustomUniverse(
  name: string,
  symbols: string[],
  ownerUserId?: string,
) {
  const key = `custom_${Date.now().toString(36)}`;
  const universe = await prisma.universe.create({
    data: {
      key,
      name,
      type: 'custom',
      ownerUserId,
      symbols: {
        create: symbols.map((symbol) => ({ symbol: symbol.toUpperCase() })),
      },
    },
    include: { symbols: true },
  });
  return universe;
}
