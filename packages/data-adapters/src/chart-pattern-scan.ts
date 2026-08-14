import { dateKeyInTimezone, getConfigTimezone } from '@sv/shared';
import {
  attachPatternBacktest,
  detectChartPatterns,
  type ChartPatternResult,
  type OhlcBar,
} from '@sv/swing';
import {
  fetchDailyBars,
  fetchFourHourBars,
  fetchHourlyBars,
  fetchIntradayBars,
} from './swing-chart.js';
import {
  persistChartPatternResult,
  recordChartPatternScanRun,
} from './chart-pattern-persist.js';
import { getDataPolicy } from '@sv/shared';
import { openSwingPositionSymbols, resolveUniverseSymbols } from './universe.js';

export interface DetectSymbolChartPatternsResult {
  symbol: string;
  bars: OhlcBar[];
  bar_count: number;
  last_bar_date: string;
  patterns: ChartPatternResult;
}

/** Run full MTF chart pattern detection for one symbol (same logic as Stock Details chart). */
export async function detectSymbolChartPatterns(
  symbol: string,
  refresh = false,
): Promise<DetectSymbolChartPatternsResult | null> {
  const normalized = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  const [bars, hourlyBars, bars5m, bars15m, bars4h] = await Promise.all([
    fetchDailyBars(normalized, refresh),
    fetchHourlyBars(normalized, refresh).catch(() => [] as Awaited<ReturnType<typeof fetchHourlyBars>>),
    fetchIntradayBars(normalized, '5m', refresh).catch(() => []),
    fetchIntradayBars(normalized, '15m', refresh).catch(() => []),
    fetchFourHourBars(normalized, refresh).catch(() => []),
  ]);

  if (bars.length < 30) return null;

  const patterns = attachPatternBacktest(
    bars,
    detectChartPatterns(bars, {}, {
      hourlyBars: hourlyBars.length >= 24 ? hourlyBars : undefined,
      fiveMinBars: bars5m.length >= 60 ? bars5m : undefined,
      fifteenMinBars: bars15m.length >= 40 ? bars15m : undefined,
      fourHourBars: bars4h.length >= 50 ? bars4h : undefined,
    }),
  );

  return {
    symbol: normalized,
    bars,
    bar_count: bars.length,
    last_bar_date: bars[bars.length - 1]!.time,
    patterns,
  };
}

export interface ChartPatternBatchScanResult {
  scan_date: string;
  symbols_total: number;
  symbols_ok: number;
  symbols_failed: number;
  patterns_found: number;
  duration_ms: number;
}

/** Scan and persist chart patterns for many symbols (daily sync / admin batch). */
export async function scanChartPatternsBatch(
  symbols: string[],
  options: { refresh?: boolean; scanDate?: string; trigger?: string } = {},
): Promise<ChartPatternBatchScanResult> {
  const started = Date.now();
  const scanDate = options.scanDate ?? dateKeyInTimezone(getConfigTimezone());
  const trigger = options.trigger ?? 'daily_sync';
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();

  let symbolsOk = 0;
  let symbolsFailed = 0;
  let patternsFound = 0;

  for (const sym of unique) {
    try {
      const detected = await detectSymbolChartPatterns(sym, options.refresh ?? false);
      if (!detected) {
        symbolsOk++;
        continue;
      }
      const saved = await persistChartPatternResult(detected.patterns, {
        symbol: detected.symbol,
        scanDate,
        lastBarDate: detected.last_bar_date,
        barCount: detected.bar_count,
        trigger,
      });
      patternsFound += saved.pattern_count;
      symbolsOk++;
    } catch {
      symbolsFailed++;
    }
  }

  const durationMs = Date.now() - started;
  const status = symbolsFailed > 0 && symbolsOk === 0 ? 'failed' : symbolsFailed > 0 ? 'partial' : 'done';

  await recordChartPatternScanRun({
    runDate: scanDate,
    trigger,
    symbolsTotal: unique.length,
    symbolsOk,
    symbolsFailed,
    patternsFound,
    durationMs,
    status,
    error: symbolsFailed > 0 ? `${symbolsFailed} symbol(s) failed` : undefined,
  }).catch(() => undefined);

  if (patternsFound > 0) {
    void import('./chart-pattern-alerts.js')
      .then(({ dispatchChartPatternAlerts }) => dispatchChartPatternAlerts({ force: false }))
      .catch(() => undefined);
  }

  return {
    scan_date: scanDate,
    symbols_total: unique.length,
    symbols_ok: symbolsOk,
    symbols_failed: symbolsFailed,
    patterns_found: patternsFound,
    duration_ms: durationMs,
  };
}

/** Symbols for batch chart pattern scan — mirrors daily sync prefetch universe. */
export async function resolveChartPatternScanSymbols(options: {
  universe?: string;
  maxSymbols?: number;
} = {}): Promise<string[]> {
  const symbols = new Set<string>();

  if (options.universe) {
    const rows = await resolveUniverseSymbols(options.universe, 0);
    for (const sym of rows) symbols.add(sym.toUpperCase());
  } else {
    const policy = getDataPolicy();
    if (policy.prefetch.enabled) {
      for (const universeKey of policy.prefetch.universes) {
        const rows = await resolveUniverseSymbols(universeKey, 0);
        for (const sym of rows) symbols.add(sym.toUpperCase());
      }
      if (policy.prefetch.include_open_positions) {
        for (const sym of await openSwingPositionSymbols()) {
          symbols.add(sym.toUpperCase());
        }
      }
    } else {
      const rows = await resolveUniverseSymbols('nifty500', 0);
      for (const sym of rows) symbols.add(sym.toUpperCase());
    }
  }

  let list = [...symbols].sort();
  if (options.maxSymbols != null && options.maxSymbols > 0) {
    list = list.slice(0, options.maxSymbols);
  }
  return list;
}

export interface ChartPatternScanTriggerResult {
  accepted: boolean;
  background: boolean;
  symbols_total: number;
  scan_date?: string;
  symbols_ok?: number;
  symbols_failed?: number;
  patterns_found?: number;
  duration_ms?: number;
}

/** Admin / manual chart pattern batch — background by default. */
export async function triggerChartPatternScan(options: {
  universe?: string;
  refresh?: boolean;
  maxSymbols?: number;
  wait?: boolean;
  trigger?: string;
} = {}): Promise<ChartPatternScanTriggerResult> {
  const symbols = await resolveChartPatternScanSymbols({
    universe: options.universe,
    maxSymbols: options.maxSymbols,
  });
  const trigger = options.trigger ?? 'admin';

  if (!options.wait) {
    void scanChartPatternsBatch(symbols, { refresh: options.refresh ?? false, trigger }).catch(() => undefined);
    return { accepted: true, background: true, symbols_total: symbols.length };
  }

  const result = await scanChartPatternsBatch(symbols, { refresh: options.refresh ?? false, trigger });
  return {
    accepted: true,
    background: false,
    symbols_total: result.symbols_total,
    scan_date: result.scan_date,
    symbols_ok: result.symbols_ok,
    symbols_failed: result.symbols_failed,
    patterns_found: result.patterns_found,
    duration_ms: result.duration_ms,
  };
}

/** Fire-and-forget persist after on-demand chart load — errors are swallowed. */
export function persistChartPatternsAsync(
  symbol: string,
  result: ChartPatternResult,
  ctx: { lastBarDate: string; barCount: number },
): void {
  const scanDate = dateKeyInTimezone(getConfigTimezone());
  void persistChartPatternResult(result, {
    symbol,
    scanDate,
    lastBarDate: ctx.lastBarDate,
    barCount: ctx.barCount,
    trigger: 'on_demand',
  }).catch(() => undefined);
}
