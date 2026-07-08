import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX } from '@sv/shared';
import {
  attachTruthToHits,
  BT_TRUTH_TTL_SEC,
  DEFAULT_MAX_PRELOAD,
  hitsForTruthPreload,
  type BacktestTruthCompact,
} from '@sv/swing';
import { truthFromBars } from '@sv/swing';
import { fetchDailyBars } from './swing-chart.js';

function truthCacheKey(symbol: string): string {
  return cacheKey(CACHE_PREFIX.SWING_AUTO, `bt_truth:${symbol.toUpperCase()}`);
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

  const bars = await fetchDailyBars(sym, refresh);
  const truth = truthFromBars(sym, bars);
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

  for (const sym of symbols) {
    const truth = await backtestTruthForSymbol(sym, refresh);
    if (truth) map[sym] = truth;
  }

  return map;
}

export async function attachBacktestTruthToHits(
  hits: Record<string, unknown>[],
  max = DEFAULT_MAX_PRELOAD,
  refresh = false,
): Promise<Record<string, unknown>[]> {
  const truthMap = await preloadBacktestTruthMap(hits, max, refresh);
  return attachTruthToHits(hits, truthMap);
}
