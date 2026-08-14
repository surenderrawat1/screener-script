import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, getCacheTtl } from '@sv/shared';

/** Radar playbook snapshot (I-A1). Not the OHLC series — those stay under sv:ta:intraday:*. */
export function intradayStateCacheKey(
  instrumentId: string,
  interval: '5m' | '15m',
  skipAccuracyGate = false,
): string {
  const id = instrumentId.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, '_') || 'nifty50';
  const gate = skipAccuracyGate ? 'nogate' : 'gate';
  return cacheKey(CACHE_PREFIX.INTRADAY, `state:${id}:${interval}:${gate}`);
}

export async function readIntradayStateSnapshot<T>(
  instrumentId: string,
  interval: '5m' | '15m',
  skipAccuracyGate = false,
): Promise<T | null> {
  return cacheGetJson<T>(intradayStateCacheKey(instrumentId, interval, skipAccuracyGate));
}

export async function writeIntradayStateSnapshot(
  instrumentId: string,
  interval: '5m' | '15m',
  state: unknown,
  skipAccuracyGate = false,
): Promise<void> {
  const ttl = getCacheTtl().intraday_state ?? 60;
  await cacheSetJson(intradayStateCacheKey(instrumentId, interval, skipAccuracyGate), state, ttl);
}
