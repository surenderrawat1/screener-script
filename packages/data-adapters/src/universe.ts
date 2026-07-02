import { prisma } from '@sv/db';

const DEFAULT_SYMBOLS: Record<string, string[]> = {
  nifty50: ['TCS', 'INFY', 'RELIANCE', 'HDFCBANK', 'ITC', 'BHARTIARTL', 'ICICIBANK', 'SBIN', 'LT', 'AXISBANK'],
  nifty100: ['TCS', 'INFY', 'RELIANCE', 'HDFCBANK', 'ITC', 'WIPRO', 'HCLTECH', 'MARUTI', 'SUNPHARMA', 'TITAN'],
  nifty500: ['TCS', 'INFY', 'RELIANCE', 'HDFCBANK', 'ITC', 'BAJFINANCE', 'ASIANPAINT', 'NESTLEIND', 'ULTRACEMCO', 'POWERGRID'],
  nifty250: ['TCS', 'INFY', 'RELIANCE', 'HDFCBANK', 'ITC', 'WIPRO', 'HCLTECH', 'MARUTI', 'SUNPHARMA', 'TITAN', 'BAJFINANCE', 'ASIANPAINT'],
};

export async function resolveUniverseSymbols(universeKey: string, maxScan: number): Promise<string[]> {
  const limit = maxScan > 0 ? maxScan : undefined;
  const universe = await prisma.universe.findUnique({
    where: { key: universeKey },
    include: { symbols: true },
  });

  if (universe && universe.symbols.length > 0) {
    const symbols = universe.symbols.map((s) => s.symbol);
    return limit ? symbols.slice(0, limit) : symbols;
  }

  const indexRows = await prisma.indexConstituent.findMany({
    where: { indexKey: universeKey, effectiveTo: null },
    ...(limit ? { take: limit } : {}),
  });
  if (indexRows.length > 0) {
    return indexRows.map((r) => r.symbol);
  }

  const nseRows = await prisma.nseEquity.findMany(limit ? { take: limit } : undefined);
  if (universeKey === 'total_nse' && nseRows.length > 0) {
    return nseRows.map((r) => r.symbol);
  }

  const defaults = DEFAULT_SYMBOLS[universeKey] ?? DEFAULT_SYMBOLS.nifty50;
  return limit ? defaults.slice(0, limit) : defaults;
}

export async function openSwingPositionSymbols(): Promise<string[]> {
  const rows = await prisma.swingPosition.findMany({
    where: { status: 'open' },
    select: { symbol: true },
  });
  return rows.map((r) => r.symbol.toUpperCase()).filter(Boolean);
}
