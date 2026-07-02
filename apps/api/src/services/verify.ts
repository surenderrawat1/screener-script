import { verifyStock } from '@sv/data-adapters';
import { prisma } from '@sv/db';
import { syncWatchlistFromVerify } from './watchlist.js';

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
  }).catch(() => undefined);

  if (userId) {
    const a = analysis as { quality_score?: number; mos?: number; recommendation?: string };
    await syncWatchlistFromVerify(userId, metrics.symbol, {
      stock_name: String(metrics.name ?? metrics.symbol),
      sector: String(metrics.sector ?? ''),
      last_score: Math.round(((a.quality_score ?? 0) * 56) / 100),
      last_mos: a.mos ?? 0,
      last_verdict: a.recommendation ?? '',
    }).catch(() => undefined);
  }

  return result;
}
