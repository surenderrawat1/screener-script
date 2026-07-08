import {
  assessScanEligibility,
  backtestSwingBars,
  buildScanSummary,
  buildSwingEngineMeta,
  evaluateEntry,
  evaluateExit,
  flattenHitForApi,
  metricsFromBars,
  scanSymbols,
  type SwingBacktestOptions,
  type SwingScanOptions,
  type SymbolContext,
} from '@sv/swing';
import { currentMarketRegime } from './market-regime.js';
import {
  BAR_SOURCE_DAILY,
  fetchDailyBars,
  fetchDailyBarsWithMeta,
  fetchHourlyBars,
} from './swing-chart.js';

export type { SymbolContext };

export type PrefetchStats = {
  cached: number;
  fetched: number;
};

function trackPrefetch(prefetch: PrefetchStats | undefined, fromCache: boolean, refresh: boolean) {
  if (!prefetch) return;
  if (refresh || !fromCache) prefetch.fetched += 1;
  else prefetch.cached += 1;
}

export async function buildSymbolContext(
  symbol: string,
  refresh = false,
  options: { include_hourly?: boolean; prefetch?: PrefetchStats } = {},
): Promise<SymbolContext | null> {
  const sym = symbol.toUpperCase().replace(/\.(NS|BO)$/, '');
  const daily = await fetchDailyBarsWithMeta(sym, refresh);
  trackPrefetch(options.prefetch, daily.fromCache, refresh);

  const hourlyBars =
    options.include_hourly === true
      ? await fetchHourlyBars(sym, refresh)
      : ([] as SymbolContext['hourlyBars']);

  if (daily.bars.length < 50) return null;
  const ta = metricsFromBars(daily.bars, sym, true);
  return {
    symbol: sym,
    bars: daily.bars,
    hourlyBars: hourlyBars?.length ? hourlyBars : undefined,
    ta,
    stale: false,
  };
}

export async function evaluateSwingSymbol(
  symbol: string,
  refresh = false,
  options: SwingScanOptions = {},
) {
  const regime = options.regime ?? (await currentMarketRegime(refresh));
  const ctx = await buildSymbolContext(symbol, refresh, { include_hourly: options.include_hourly !== false });
  if (!ctx) return { ok: false, error: 'Insufficient chart data' };
  const price = Number(ctx.ta.ta_price ?? ctx.bars[ctx.bars.length - 1]?.close ?? 0);
  const entry = evaluateEntry(ctx.ta, price, ctx.bars, regime, ctx.hourlyBars);
  const lastBar = ctx.bars[ctx.bars.length - 1];
  const asOfDate = lastBar?.time ? String(lastBar.time).slice(0, 10) : null;
  return {
    ok: true,
    symbol: ctx.symbol,
    price,
    as_of_date: asOfDate,
    regime,
    entry,
    entry_rules: entry.rules,
    ta: ctx.ta,
    engine_meta: buildSwingEngineMeta(),
    scan_eligibility: assessScanEligibility(entry as Record<string, unknown>, ctx.ta, price, options),
    filters: {
      min_verdict: options.min_verdict ?? null,
      gc9_only: options.gc9_only ?? false,
      zone_52w: options.zone_52w ?? 'any',
      min_rules_passed: options.min_rules_passed ?? null,
      require_rules: options.require_rules ?? [],
      breakout_volume: options.breakout_volume ?? false,
    },
  };
}

export async function evaluateSwingExit(
  symbol: string,
  entryPrice: number,
  entryDate: string,
  refresh = false,
  options: { profit_target?: number; target_pct?: number } = {},
) {
  const regime = await currentMarketRegime(refresh);
  const ctx = await buildSymbolContext(symbol, refresh, { include_hourly: true });
  if (!ctx) return { ok: false, error: 'Insufficient chart data' };
  const price = Number(ctx.ta.ta_price ?? ctx.bars[ctx.bars.length - 1]?.close ?? 0);
  const asOfDate = ctx.bars[ctx.bars.length - 1]?.time ? String(ctx.bars[ctx.bars.length - 1].time).slice(0, 10) : null;
  const ta = { ...ctx.ta, as_of_date: asOfDate };
  const exit = evaluateExit(
    ta,
    price,
    entryPrice,
    entryDate,
    null,
    null,
    ctx.bars,
    ctx.bars,
    options.profit_target ?? null,
    options.target_pct ?? null,
    regime,
    ctx.hourlyBars,
  );
  return {
    ok: true,
    symbol: ctx.symbol,
    price,
    as_of_date: asOfDate,
    regime,
    exit,
    engine_meta: buildSwingEngineMeta(),
  };
}

export async function runSwingScan(
  symbols: string[],
  options: SwingScanOptions = {},
  refresh = false,
) {
  const regime = options.regime ?? (await currentMarketRegime(refresh));
  const includeHourly = options.include_hourly === true;
  const scanOpts = { ...options, regime, include_hourly: includeHourly };
  const prefetch: PrefetchStats = { cached: 0, fetched: 0 };
  const contexts: SymbolContext[] = [];
  for (const sym of symbols) {
    const ctx = await buildSymbolContext(sym, refresh, { include_hourly: includeHourly, prefetch });
    if (ctx) contexts.push(ctx);
  }
  const result = scanSymbols(contexts, scanOpts);
  const noChartFetch = symbols.length - contexts.length;
  const noChartInScan = result.filter_stats.no_ta;
  return {
    ...result,
    symbols_requested: symbols.length,
    symbols_with_data: contexts.length,
    source: BAR_SOURCE_DAILY,
    prefetch,
    scan_summary: buildScanSummary(result.hits, String(scanOpts.min_verdict ?? 'SETUP_PLUS'), {
      no_chart: noChartFetch + noChartInScan,
      universe_size: symbols.length,
      scanned: symbols.length,
    }),
    hits: result.hits.map((h) => flattenHitForApi(h as Record<string, unknown>) as typeof h),
  };
}

export async function runSwingBacktest(
  symbol: string,
  options: SwingBacktestOptions = {},
  refresh = false,
) {
  const sym = symbol.toUpperCase().replace(/\.(NS|BO)$/, '');
  const regime = options.regime ?? (await currentMarketRegime(refresh));
  const bars = await fetchDailyBars(sym, refresh);
  return backtestSwingBars(sym, bars, { ...options, regime });
}
