import { verifyStock } from '@sv/data-adapters';
import { prisma } from '@sv/db';
import { syncWatchlistFromVerify } from './watchlist.js';

export async function verifySymbol(symbol: string, refresh = false, userId?: string) {
  const {
    metrics,
    analysis,
    memo,
    assumptions,
    screening_mode,
    sources,
    from_cache,
    company_name,
  } = await verifyStock(symbol, refresh);

  const result = {
    symbol: metrics.symbol,
    success: true,
    company_name,
    metrics,
    analysis,
    memo,
    assumptions,
    screening_mode,
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
    const a = analysis as {
      quality_score?: number;
      verify_score?: number;
      mos?: number | null;
      recommendation?: string;
    };
    await syncWatchlistFromVerify(userId, metrics.symbol, {
      stock_name: String(company_name ?? metrics.name ?? metrics.symbol),
      sector: String(metrics.sector ?? ''),
      last_score: a.verify_score ?? Math.round(((a.quality_score ?? 0) * 56) / 100),
      last_mos: a.mos ?? null,
      last_verdict: a.recommendation ?? '',
    }).catch(() => undefined);
  }

  return result;
}
