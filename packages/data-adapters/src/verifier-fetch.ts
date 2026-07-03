import type { StockMetrics } from '@sv/shared';
import { resolveStockMetrics } from './screener-run.js';
import { fetchScreenerAnnualFinancials } from './screener-annual.js';import { getPromoterPledge } from './promoter-pledge.js';
import {
  buildVerifierAutoFill,
  metricsToVerifierBlob,
  type VerifierFetchBlob,
} from './verifier-autofill.js';

export interface VerifierFetchResult {
  success: boolean;
  symbol: string;
  sources: string[];
  from_cache?: boolean;
  metrics?: StockMetrics;
  blob?: VerifierFetchBlob;
  auto?: { input: Record<string, string | number | boolean>; auto_keys: string[] };
  error?: string;
}

export async function fetchVerifierData(
  symbol: string,
  refresh = false,
): Promise<VerifierFetchResult> {
  const baseSymbol = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  if (!baseSymbol) {
    return { success: false, symbol: '', sources: [], error: 'Empty symbol' };
  }

  const [metricsResult, annual] = await Promise.all([
    resolveStockMetrics(baseSymbol, refresh),
    fetchScreenerAnnualFinancials(baseSymbol, refresh),
  ]);

  const { metrics, sources, from_cache } = metricsResult;
  const pledge = getPromoterPledge(baseSymbol);
  const patCr =
    annual?.pat_history.length
      ? annual.pat_history[annual.pat_history.length - 1]
      : 0;

  const blob = metricsToVerifierBlob(metrics as StockMetrics, {
    revenue_history: annual?.revenue_history ?? [],
    pat_cr: patCr,
    shareholders_equity_cr: annual?.shareholders_equity_cr ?? 0,
    summary: annual?.summary ?? '',
    promoter_pledge: pledge?.pct ?? 0,
    promoter_pledge_as_of: pledge?.as_of ?? '',
    peg: Number((metrics as Record<string, unknown>).peg_ratio ?? 0),
  });

  if (
    annual?.company_name &&
    (!blob.company_name || blob.company_name.toUpperCase() === baseSymbol)
  ) {
    blob.company_name = annual.company_name;
  }

  const auto = buildVerifierAutoFill(blob);

  const allSources = [...sources];
  if (annual?.revenue_history.length) allSources.push('Screener.in (annual P&L)');
  if (pledge) allSources.push(`Pledge (${pledge.source})`);

  return {
    success: true,
    symbol: baseSymbol,
    sources: [...new Set(allSources)],
    from_cache,
    metrics,
    blob,
    auto,
  };
}
