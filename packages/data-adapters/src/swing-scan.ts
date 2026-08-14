import {
  applyFundamentalQuality,
  assessScanEligibility,
  BACKTEST_LOOKBACK_YEARS,
  BACKTEST_METHOD,
  backtestSwingBars,
  buildScanSummary,
  buildSwingEngineMeta,
  evaluateEntry,
  evaluateExit,
  flattenHitForApi,
  metricsFromBars,
  prepareBacktestBars,
  replayAutoTiers,
  scanSymbols,
  type SwingBacktestOptions,
  type SwingScanOptions,
  type SymbolContext,
} from '@sv/swing';
import { currentMarketRegime } from './market-regime.js';
import {
  BAR_SOURCE_DAILY,
  fetchBacktestBars,
  fetchDailyBarsWithMeta,
  fetchHourlyBars,
  preloadTaBarsCache,
  type TaBarsCachePayload,
} from './swing-chart.js';
import { attachFundamentalQualityToHits } from './fundamental-quality-attach.js';
import { fetchStockData } from './stock-data-fetcher.js';

export type { SymbolContext };

export type PrefetchStats = {
  cached: number;
  fetched: number;
};

/** Parallel chart/TA fetch concurrency for universe and auto scans (Phase B1). */
export const SWING_SCAN_CONCURRENCY = 8;

/**
 * Run async work over items in fixed-size batches (order-preserving).
 * Used by `runSwingScan` so Yahoo/cache fetches are not strictly sequential.
 */
export async function mapInBatches<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onBatch?: (processed: number, total: number) => void | Promise<void>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  const out: R[] = [];
  const total = items.length;
  for (let start = 0; start < items.length; start += limit) {
    const batch = items.slice(start, start + limit);
    const batchResults = await Promise.all(
      batch.map((item, offset) => fn(item, start + offset)),
    );
    out.push(...batchResults);
    if (onBatch) await onBatch(Math.min(start + batch.length, total), total);
  }
  return out;
}

function trackPrefetch(prefetch: PrefetchStats | undefined, fromCache: boolean, refresh: boolean) {
  if (!prefetch) return;
  if (refresh || !fromCache) prefetch.fetched += 1;
  else prefetch.cached += 1;
}

export async function buildSymbolContext(
  symbol: string,
  refresh = false,
  options: {
    include_hourly?: boolean;
    prefetch?: PrefetchStats;
    preloaded?: Map<string, TaBarsCachePayload | null>;
  } = {},
): Promise<SymbolContext | null> {
  const sym = symbol.toUpperCase().replace(/\.(NS|BO)$/, '');
  const daily = await fetchDailyBarsWithMeta(sym, refresh, { preloaded: options.preloaded });
  trackPrefetch(options.prefetch, daily.fromCache, refresh);

  const hourlyBars =
    options.include_hourly === true
      ? await fetchHourlyBars(sym, refresh, { preloaded: options.preloaded })
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
  const fund = await fetchStockData(ctx.symbol, { refresh }).catch(() => null);
  const qualityHit = applyFundamentalQuality(
    {
      ...entry,
      symbol: ctx.symbol,
      strict_verdict: entry.strict_verdict,
      strict_enter_ready: entry.strict_enter_ready,
      verdict: entry.discovery_verdict ?? entry.verdict,
    } as Record<string, unknown>,
    {
      roe: Number(fund?.metrics?.roe ?? 0),
      roce: Number(fund?.metrics?.roce ?? 0),
      sector: fund?.metrics?.sector != null ? String(fund.metrics.sector) : null,
      industry: fund?.metrics?.industry != null ? String(fund.metrics.industry) : null,
      symbol: ctx.symbol,
    },
  );
  return {
    ok: true,
    symbol: ctx.symbol,
    price,
    as_of_date: asOfDate,
    regime,
    entry: {
      ...entry,
      strict_verdict: qualityHit.strict_verdict,
      strict_enter_ready: qualityHit.strict_enter_ready,
      fundamental_quality_ok: qualityHit.fundamental_quality_ok,
      fundamental_quality_status: qualityHit.fundamental_quality_status,
      fundamental_quality_summary: qualityHit.fundamental_quality_summary,
      roe: qualityHit.roe,
      roce: qualityHit.roce,
    },
    entry_rules: entry.rules,
    ta: ctx.ta,
    fundamentals: {
      roe: qualityHit.roe,
      roce: qualityHit.roce,
      quality: qualityHit.fundamental_quality_summary,
      ok: qualityHit.fundamental_quality_ok,
    },
    engine_meta: buildSwingEngineMeta(),
    scan_eligibility: assessScanEligibility(
      {
        ...entry,
        strict_verdict: qualityHit.strict_verdict,
        strict_enter_ready: qualityHit.strict_enter_ready,
      } as Record<string, unknown>,
      ctx.ta,
      price,
      options,
    ),
    filters: {
      min_verdict: options.min_verdict ?? null,
      gc9_only: options.gc9_only ?? false,
      zone_52w: options.zone_52w ?? 'any',
      min_rules_passed: options.min_rules_passed ?? null,
      require_rules: options.require_rules ?? [],
      breakout_volume: options.breakout_volume ?? false,
      min_roe_pct: 15,
      min_roce_pct: 15,
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

export type SwingScanProgress = {
  phase: string;
  total: number;
  processed: number;
  passed?: number;
};

export async function runSwingScan(
  symbols: string[],
  options: SwingScanOptions & {
    concurrency?: number;
    onProgress?: (progress: SwingScanProgress) => void | Promise<void>;
  } = {},
  refresh = false,
) {
  const startedAt = Date.now();
  const regime = options.regime ?? (await currentMarketRegime(refresh));
  const includeHourly = options.include_hourly === true;
  const { onProgress, concurrency: concurrencyOpt, ...scanOptionRest } = options;
  const scanOpts = { ...scanOptionRest, regime, include_hourly: includeHourly };
  const concurrency = Math.max(
    1,
    Math.floor(Number(concurrencyOpt ?? SWING_SCAN_CONCURRENCY) || SWING_SCAN_CONCURRENCY),
  );
  const prefetch: PrefetchStats = { cached: 0, fetched: 0 };
  // Phase B5 — one MGET for the refresh set instead of N Redis GETs.
  const preloaded = refresh
    ? undefined
    : await preloadTaBarsCache(symbols, { include_hourly: includeHourly });

  if (onProgress) {
    await onProgress({ phase: 'scan', total: symbols.length, processed: 0, passed: 0 });
  }

  const built = await mapInBatches(
    symbols,
    concurrency,
    (sym) =>
      buildSymbolContext(sym, refresh, {
        include_hourly: includeHourly,
        prefetch,
        preloaded,
      }),
    async (processed, total) => {
      if (onProgress) await onProgress({ phase: 'scan', total, processed, passed: 0 });
    },
  );
  const contexts: SymbolContext[] = built.filter((ctx): ctx is SymbolContext => ctx != null);
  const result = scanSymbols(contexts, scanOpts);
  const noChartFetch = symbols.length - contexts.length;
  const noChartInScan = result.filter_stats.no_ta;
  const flatHits = result.hits.map((h) => flattenHitForApi(h as Record<string, unknown>) as typeof h);
  const hitsWithQuality = await attachFundamentalQualityToHits(flatHits as Record<string, unknown>[], refresh);
  if (onProgress) {
    await onProgress({
      phase: 'scan',
      total: symbols.length,
      processed: symbols.length,
      passed: hitsWithQuality.length,
    });
  }
  const elapsedSec = Math.round(((Date.now() - startedAt) / 1000) * 10) / 10;
  return {
    ...result,
    symbols_requested: symbols.length,
    symbols_with_data: contexts.length,
    source: BAR_SOURCE_DAILY,
    prefetch,
    concurrency,
    ta_mget_keys: preloaded?.size ?? 0,
    elapsed_sec: elapsedSec,
    scan_summary: buildScanSummary(
      hitsWithQuality as typeof result.hits,
      String(scanOpts.min_verdict ?? 'SETUP_PLUS'),
      {
        no_chart: noChartFetch + noChartInScan,
        universe_size: symbols.length,
        scanned: symbols.length,
      },
    ),
    hits: hitsWithQuality,
  };
}

export async function runSwingBacktest(
  symbol: string,
  options: SwingBacktestOptions & { auto_tiers?: boolean } = {},
  refresh = false,
) {
  const sym = symbol.toUpperCase().replace(/\.(NS|BO)$/, '');
  const raw = await fetchBacktestBars(sym, refresh);
  const prepared = prepareBacktestBars(raw, BACKTEST_LOOKBACK_YEARS, options.warmup);
  const niftyRaw = options.regime_bars?.length
    ? options.regime_bars
    : await fetchBacktestBars('NIFTYBEES', refresh).catch(() => []);
  const niftyPrepared = niftyRaw.length
    ? prepareBacktestBars(niftyRaw, BACKTEST_LOOKBACK_YEARS, options.warmup).bars
    : [];

  // Prefer historical regime across the window; only freeze when caller asks.
  const freeze = Boolean(options.freeze_regime && options.regime);
  const regime = freeze ? options.regime : undefined;

  const btOpts = {
    ...options,
    regime,
    freeze_regime: freeze,
    regime_bars: niftyPrepared.length ? niftyPrepared : options.regime_bars,
    warmup: prepared.warmup,
  };
  const result = backtestSwingBars(sym, prepared.bars, btOpts);
  const includeTiers = options.auto_tiers !== false;
  const autoTiers = includeTiers ? replayAutoTiers(sym, prepared.bars, btOpts) : null;

  return {
    ...result,
    chart_from: prepared.chart_from,
    chart_to: prepared.chart_to,
    lookback_years: BACKTEST_LOOKBACK_YEARS,
    method: BACKTEST_METHOD,
    auto_tiers: autoTiers,
  };
}
