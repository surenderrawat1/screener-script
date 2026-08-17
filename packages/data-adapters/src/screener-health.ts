import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX } from '@sv/shared';

const HEALTH_KEY = cacheKey(CACHE_PREFIX.SCREENER_TABLE, 'health:parser');
const HEALTH_TTL_SECONDS = 604800; // 7d — PHP screener_health TTL

export interface ScreenerHealthStats {
  pages: number;
  failures: number;
  empty_pages: number;
  rows: number;
  last_at: string;
}

export interface ScreenerHealthSummary {
  healthy: boolean;
  pages: number;
  failures: number;
  empty_pages: number;
  rows: number;
  failure_rate: number;
  empty_rate: number;
  last_at: string;
}

const EMPTY_STATS: ScreenerHealthStats = {
  pages: 0,
  failures: 0,
  empty_pages: 0,
  rows: 0,
  last_at: '',
};

export function summarizeScreenerHealth(stats: ScreenerHealthStats | null | undefined): ScreenerHealthSummary {
  const pages = stats?.pages ?? 0;
  const failures = stats?.failures ?? 0;
  const empty_pages = stats?.empty_pages ?? 0;
  const rows = stats?.rows ?? 0;
  const failure_rate = pages > 0 ? Math.round((failures / pages) * 1000) / 1000 : 0;
  const empty_rate = pages > 0 ? Math.round((empty_pages / pages) * 1000) / 1000 : 0;
  const healthy = pages === 0 || (failure_rate < 0.25 && empty_rate < 0.5);

  return {
    healthy,
    pages,
    failures,
    empty_pages,
    rows,
    failure_rate,
    empty_rate,
    last_at: stats?.last_at ?? '',
  };
}

export async function getScreenerHealthSummary(): Promise<ScreenerHealthSummary> {
  const stats = await cacheGetJson<ScreenerHealthStats>(HEALTH_KEY);
  return summarizeScreenerHealth(stats);
}

/** Record one Screener.in page fetch (network only — not cache hits). */
export async function recordScreenerPageFetch(htmlOk: boolean, rowCount: number): Promise<void> {
  const stats = (await cacheGetJson<ScreenerHealthStats>(HEALTH_KEY)) ?? { ...EMPTY_STATS };

  stats.pages = (stats.pages ?? 0) + 1;
  if (!htmlOk) {
    stats.failures = (stats.failures ?? 0) + 1;
  } else if (rowCount <= 0) {
    stats.empty_pages = (stats.empty_pages ?? 0) + 1;
  }
  stats.rows = (stats.rows ?? 0) + Math.max(0, rowCount);
  stats.last_at = new Date().toISOString();

  await cacheSetJson(HEALTH_KEY, stats, HEALTH_TTL_SECONDS);
}

/** Lightweight parse signal — avoids importing ratio parser from screener-in. */
export function screenerHtmlRowCount(html: string): number {
  if (!html || html.length < 200) return 0;
  if (!/<span class="name">\s*ROCE\s*<\/span>/i.test(html)) return 0;
  if (!/<span class="number">/i.test(html)) return 0;
  return 1;
}
