import { cacheGetJson, cacheGetJsonMany, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX } from '@sv/shared';
import {
  attachTruthToHits,
  BT_TRUTH_TTL_SEC,
  DEFAULT_MAX_PRELOAD,
  hitsForTruthPreload,
  type BacktestTruthCompact,
} from '@sv/swing';
import { truthFromBars } from '@sv/swing';
import { fetchBacktestBars } from './swing-chart.js';
import { mapInBatches } from './swing-scan.js';

function truthCacheKey(symbol: string): string {
  return cacheKey(CACHE_PREFIX.SWING_AUTO, `bt_truth:v9-real-fill-edge:${symbol.toUpperCase()}`);
}

/** True when top-ranked hits already carry backtest_truth (scan stamped the snapshot). */
export function hitsHaveBacktestTruth(
  hits: Record<string, unknown>[],
  max = DEFAULT_MAX_PRELOAD,
): boolean {
  const needed = hitsForTruthPreload(hits, max);
  if (needed.length === 0) return true;
  const have = new Set(
    hits
      .filter((h) => h.backtest_truth && typeof h.backtest_truth === 'object')
      .map((h) => String(h.symbol ?? '').toUpperCase().replace(/\.(NS|BO)$/, '')),
  );
  return needed.every((sym) => have.has(sym));
}

export async function backtestTruthForSymbol(
  symbol: string,
  refresh = false,
): Promise<BacktestTruthCompact | null> {
  const sym = symbol.toUpperCase().replace(/\.(NS|BO)$/, '');
  if (!sym) return null;

  const key = truthCacheKey(sym);
  if (!refresh) {
    const cached = await cacheGetJson<BacktestTruthCompact>(key);
    if (cached?.symbol) return cached;
  }

  const [bars, nifty] = await Promise.all([
    fetchBacktestBars(sym, refresh),
    fetchBacktestBars('NIFTYBEES', refresh).catch(() => [] as Awaited<ReturnType<typeof fetchBacktestBars>>),
  ]);
  const truth = truthFromBars(sym, bars, nifty);
  if (!truth) return null;

  await cacheSetJson(key, truth, BT_TRUTH_TTL_SEC);
  return truth;
}

export async function preloadBacktestTruthMap(
  hits: Record<string, unknown>[],
  max = DEFAULT_MAX_PRELOAD,
  refresh = false,
): Promise<Record<string, BacktestTruthCompact>> {
  const symbols = hitsForTruthPreload(hits, max);
  const map: Record<string, BacktestTruthCompact> = {};
  if (symbols.length === 0) return map;

  if (!refresh) {
    const cached = await cacheGetJsonMany<BacktestTruthCompact>(symbols.map(truthCacheKey));
    for (let i = 0; i < symbols.length; i++) {
      const row = cached[i];
      if (row?.symbol) map[symbols[i]] = row;
    }
  }

  const missing = symbols.filter((sym) => !map[sym]);
  if (missing.length === 0) return map;

  // Compute cache misses in parallel (bounded) — avoids 40 sequential Yahoo/Redis round-trips.
  await mapInBatches(missing, 4, async (sym) => {
    const truth = await backtestTruthForSymbol(sym, refresh);
    if (truth) map[sym] = truth;
    return truth;
  });

  return map;
}

export async function attachBacktestTruthToHits(
  hits: Record<string, unknown>[],
  max = DEFAULT_MAX_PRELOAD,
  refresh = false,
): Promise<Record<string, unknown>[]> {
  if (!refresh && hitsHaveBacktestTruth(hits, max)) return hits;
  const truthMap = await preloadBacktestTruthMap(hits, max, refresh);
  return attachTruthToHits(hits, truthMap);
}
