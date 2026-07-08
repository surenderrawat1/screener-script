import { prisma } from '@sv/db';
import { BUILTIN_UNIVERSES } from '@sv/shared';
import {
  ETF_CATEGORY,
  ETF_UNIVERSE_ID,
  SWING_TIER_A_UNIVERSE_ID,
  TIER_A_SYMBOLS,
  etfSymbols,
} from '@sv/swing';
import { resolveUniverseSymbols } from '@sv/data-adapters';

export { resolveUniverseSymbols };

const PRESET_UNIVERSES = [
  {
    key: SWING_TIER_A_UNIVERSE_ID,
    name: 'Tier-A swing book (12 names)',
    type: 'builtin' as const,
    symbolCount: TIER_A_SYMBOLS.length,
  },
  {
    key: ETF_UNIVERSE_ID,
    name: 'NSE ETF swing book',
    type: 'builtin' as const,
    symbolCount: etfSymbols().length,
  },
  {
    key: 'swing_etf_rotation',
    name: 'ETF rotation book',
    type: 'builtin' as const,
    symbolCount: etfSymbols(ETF_CATEGORY.ROTATION).length,
  },
];

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
    return [
      ...BUILTIN_UNIVERSES.map((u) => ({
        key: u.key,
        name: u.name,
        type: 'builtin',
        symbolCount: DEFAULT_SYMBOLS[u.key]?.length ?? 0,
      })),
      ...PRESET_UNIVERSES,
    ];
  }

  const byKey = new Map(dbUniverses.map((u) => [u.key, u]));
  const merged: Array<{
    id?: string;
    key: string;
    name: string;
    type: string;
    symbolCount: number;
  }> = dbUniverses.map((u) => ({
    id: u.id,
    key: u.key,
    name: u.name,
    type: u.type,
    symbolCount: u._count.symbols,
  }));

  for (const preset of PRESET_UNIVERSES) {
    if (!byKey.has(preset.key)) {
      merged.push(preset);
    }
  }

  return merged.sort((a, b) => a.name.localeCompare(b.name));
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
