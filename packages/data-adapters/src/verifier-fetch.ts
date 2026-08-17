import type { StockMetrics } from '@sv/shared';
import { resolveStockMetrics } from './screener-run.js';
import { fetchScreenerAnnualFinancials } from './screener-annual.js';
import {
  buildVerifierAutoFill,
  metricsToVerifierBlob,
  type VerifierFetchBlob,
} from './verifier-autofill.js';
import {
  applyScreenerWarningsToVerifierAutofill,
  type ScreenerInsightWarning,
  type ScreenerVerifierGatePatch,
} from './screener-insights.js';
import {
  applyShareholdingVerifierPatches,
  type ScreenerShareholding,
} from './screener-shareholding.js';

export interface VerifierFetchResult {
  success: boolean;
  symbol: string;
  sources: string[];
  from_cache?: boolean;
  metrics?: StockMetrics;
  blob?: VerifierFetchBlob;
  auto?: { input: Record<string, string | number | boolean>; auto_keys: string[] };
  screener_insights?: {
    pros: string[];
    cons: string[];
    warnings: ScreenerInsightWarning[];
    has_critical: boolean;
    has_watch: boolean;
    source: string;
  } | null;
  screener_gate_adjustments?: ScreenerVerifierGatePatch[];
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
  const pledgeKnown =
    (metrics as Record<string, unknown>).promoter_pledge != null ||
    annual?.promoter_pledge_pct != null;
  const pledgePct = pledgeKnown
    ? Number(
        (metrics as Record<string, unknown>).promoter_pledge ??
          annual?.promoter_pledge_pct ??
          0,
      )
    : undefined;
  const pledgeAsOf = String((metrics as Record<string, unknown>).promoter_pledge_as_of ?? annual?.promoter_pledge_as_of ?? '');
  const pledgeSource = String((metrics as Record<string, unknown>).promoter_pledge_source ?? '');
  const patCr =
    annual?.pat_history.length
      ? annual.pat_history[annual.pat_history.length - 1]
      : 0;

  const blob = metricsToVerifierBlob(metrics as StockMetrics, {
    revenue_history: annual?.revenue_history ?? [],
    pat_cr: patCr,
    shareholders_equity_cr: annual?.shareholders_equity_cr ?? 0,
    summary: annual?.summary ?? '',
    promoter_pledge: pledgePct,
    promoter_pledge_as_of: pledgeAsOf,
    peg: Number((metrics as Record<string, unknown>).peg_ratio ?? 0),
  });

  if (
    annual?.company_name &&
    (!blob.company_name || blob.company_name.toUpperCase() === baseSymbol)
  ) {
    blob.company_name = annual.company_name;
  }

  const auto = buildVerifierAutoFill(blob);
  const screenerWarnings = (metrics as Record<string, unknown>).screener_warnings as
    | ScreenerInsightWarning[]
    | undefined;
  const patched = applyScreenerWarningsToVerifierAutofill(
    auto.input as Record<string, string | number | boolean>,
    auto.auto_keys,
    screenerWarnings ?? [],
  );
  const shareholding = (metrics as Record<string, unknown>).shareholding as
    | ScreenerShareholding
    | undefined;
  const withShareholding = applyShareholdingVerifierPatches(
    patched.input,
    patched.auto_keys,
    shareholding ?? annual?.shareholding ?? null,
  );
  const gateAdjustments: ScreenerVerifierGatePatch[] = [
    ...patched.adjustments,
    ...withShareholding.adjustments.map((a) => ({
      field: a.field,
      value: a.value,
      reason: a.reason,
      severity: 'watch' as const,
    })),
  ];

  const screenerPros = (metrics as Record<string, unknown>).screener_pros as string[] | undefined;
  const screenerCons = (metrics as Record<string, unknown>).screener_cons as string[] | undefined;
  const screenerInsights =
    screenerWarnings?.length || screenerPros?.length || screenerCons?.length
      ? {
          pros: screenerPros ?? [],
          cons: screenerCons ?? [],
          warnings: screenerWarnings ?? [],
          has_critical: Boolean((metrics as Record<string, unknown>).screener_has_critical),
          has_watch: Boolean((metrics as Record<string, unknown>).screener_has_watch),
          source: String((metrics as Record<string, unknown>).screener_insights_source ?? 'screener.in'),
        }
      : null;

  const allSources = [...sources];
  if (annual?.revenue_history.length) allSources.push('Screener.in (annual P&L)');
  if (screenerWarnings?.length) allSources.push('Screener.in (checklist gates)');
  if (shareholding?.promoter) allSources.push('Screener.in (shareholding pattern)');
  if (pledgePct != null && pledgePct > 0 && pledgeSource) allSources.push(`Pledge (${pledgeSource})`);
  if (!pledgeKnown) allSources.push('Pledge (unknown — confirm on Screener.in / BSE filings)');

  return {
    success: true,
    symbol: baseSymbol,
    sources: [...new Set(allSources)],
    from_cache,
    metrics,
    blob,
    auto: {
      input: withShareholding.input as Record<string, string | number | boolean>,
      auto_keys: withShareholding.auto_keys,
    },
    screener_insights: screenerInsights,
    screener_gate_adjustments: gateAdjustments,
  };
}
