import { analyzeSymbol, buildStockMetrics, normalizeSymbol } from '@sv/core';
import { getStockCache, setStockCache } from '@sv/cache';
import { prisma } from '@sv/db';

export async function verifySymbol(symbol: string, refresh = false, userId?: string) {
  const sym = normalizeSymbol(symbol);
  let metrics = refresh ? null : await getStockCache(sym);

  if (!metrics) {
    const stock = buildStockMetrics(sym);
    metrics = stock as Record<string, unknown>;
    await setStockCache(sym, metrics);
  }

  const analysis = analyzeSymbol(metrics as Parameters<typeof analyzeSymbol>[0]);

  const result = {
    symbol: sym,
    success: true,
    metrics,
    analysis,
    educational_only: true,
    disclaimer: 'Research tool only — not SEBI-registered investment advice.',
  };

  await prisma.verificationRun.create({
    data: {
      userId,
      symbol: sym,
      mode: 'auto',
      result: result as object,
    },
  });

  return result;
}
