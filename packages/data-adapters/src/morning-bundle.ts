import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, CACHE_TTL } from '@sv/shared';
import { getMorningEtfPanel } from './morning-etf.js';

export const MORNING_ETF_REVALIDATE_AGE_SEC = 480;

export function morningBundleCacheKey(userId?: string): string {
  return cacheKey(CACHE_PREFIX.MORNING, `bundle:${userId ?? 'system'}`);
}

export async function getCachedMorningBundle(userId?: string) {
  return cacheGetJson<{ briefing: Record<string, unknown>; cached_at: string }>(
    morningBundleCacheKey(userId),
  );
}

export async function setCachedMorningBundle(userId: string | undefined, briefing: Record<string, unknown>) {
  await cacheSetJson(
    morningBundleCacheKey(userId),
    { briefing, cached_at: new Date().toISOString() },
    CACHE_TTL.morning_bundle,
  );
}

export function etfPanelAgeSec(etf: { cached_at?: string | null }): number | null {
  const ts = etf.cached_at ? Date.parse(etf.cached_at) : NaN;
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}

export function shouldRevalidateEtfPanel(etf: { from_cache?: boolean; cached_at?: string | null }): boolean {
  if (!etf.from_cache) return false;
  const age = etfPanelAgeSec(etf);
  return age != null && age >= MORNING_ETF_REVALIDATE_AGE_SEC;
}

let revalidateInFlight = false;

export function scheduleEtfPanelRevalidate(): void {
  if (revalidateInFlight) return;
  revalidateInFlight = true;
  void getMorningEtfPanel(true)
    .catch(() => undefined)
    .finally(() => {
      revalidateInFlight = false;
    });
}
