import { verifyStock } from '@sv/data-adapters';
import { prisma } from '@sv/db';

export async function verifySymbol(symbol: string, refresh = false, userId?: string) {
  const { metrics, analysis, sources, from_cache } = await verifyStock(symbol, refresh);

  const result = {
    symbol: metrics.symbol,
    success: true,
    metrics,
    analysis,
    sources,
    from_cache,
    educational_only: true,
    disclaimer: 'Research tool only — not SEBI-registered investment advice.',
  };

  await prisma.verificationRun.create({
    data: {
      userId,
      symbol: metrics.symbol,
      mode: 'auto',
      result: result as object,
    },
  });

  return result;
}
