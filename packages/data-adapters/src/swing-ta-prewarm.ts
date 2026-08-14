import { acquireCacheLock, releaseCacheLock } from '@sv/cache';
import { ROTATE_BATCH } from '@sv/swing';
import { buildSymbolContext, mapInBatches, type PrefetchStats } from './swing-scan.js';
import { preloadTaBarsCache } from './swing-chart.js';

/** Low-priority concurrency so pre-warm does not starve live Auto / paper ticks. */
export const SWING_TA_PREWARM_CONCURRENCY = 3;
/** How many rotate batches ahead to warm after a scan. */
export const SWING_TA_PREWARM_BATCHES_AHEAD = 2;
const PREWARM_LOCK_KEY = 'sv:lock:swing-ta-prewarm';
const PREWARM_LOCK_TTL_SEC = 120;

export type SwingTaPrewarmResult = {
  ok: boolean;
  warmed: number;
  requested: number;
  cached: number;
  fetched: number;
  skipped: boolean;
  reason?: string;
  duration_ms: number;
};

/** Next N rotate-batch symbols from `rotateOffset` (wraps around the universe). */
export function upcomingRotateSymbols(
  universeSymbols: string[],
  rotateOffset: number,
  batchesAhead = SWING_TA_PREWARM_BATCHES_AHEAD,
  batchSize = ROTATE_BATCH,
): string[] {
  const total = universeSymbols.length;
  if (total <= 0) return [];
  const batch = Math.max(1, Math.min(batchSize, total));
  const want = Math.min(total, batch * Math.max(1, Math.floor(batchesAhead)));
  const out: string[] = [];
  const seen = new Set<string>();
  let offset = ((Math.floor(rotateOffset) % total) + total) % total;
  for (let i = 0; i < want; i++) {
    const sym = String(universeSymbols[(offset + i) % total] ?? '')
      .toUpperCase()
      .replace(/\.(NS|BO)$/, '');
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out;
}

/**
 * Fill / refresh `sv:ta` bar caches for symbols (daily + optional hourly).
 * Uses refresh=false so fresh cache entries are left alone (Phase B2).
 */
export async function prewarmSwingTaCache(
  symbols: string[],
  options: {
    include_hourly?: boolean;
    concurrency?: number;
    refresh?: boolean;
  } = {},
): Promise<SwingTaPrewarmResult> {
  const started = Date.now();
  const unique = [
    ...new Set(
      symbols
        .map((s) => String(s ?? '').toUpperCase().replace(/\.(NS|BO)$/, ''))
        .filter(Boolean),
    ),
  ];
  if (unique.length === 0) {
    return {
      ok: true,
      warmed: 0,
      requested: 0,
      cached: 0,
      fetched: 0,
      skipped: true,
      reason: 'No symbols to pre-warm',
      duration_ms: 0,
    };
  }

  const lockToken = await acquireCacheLock(PREWARM_LOCK_KEY, PREWARM_LOCK_TTL_SEC);
  if (!lockToken) {
    return {
      ok: true,
      warmed: 0,
      requested: unique.length,
      cached: 0,
      fetched: 0,
      skipped: true,
      reason: 'Swing TA pre-warm lock held',
      duration_ms: Date.now() - started,
    };
  }

  const prefetch: PrefetchStats = { cached: 0, fetched: 0 };
  const concurrency = Math.max(
    1,
    Math.floor(options.concurrency ?? SWING_TA_PREWARM_CONCURRENCY) || SWING_TA_PREWARM_CONCURRENCY,
  );
  const includeHourly = options.include_hourly !== false;
  const refresh = options.refresh === true;

  try {
    const preloaded = refresh
      ? undefined
      : await preloadTaBarsCache(unique, { include_hourly: includeHourly });
    const built = await mapInBatches(unique, concurrency, (sym) =>
      buildSymbolContext(sym, refresh, { include_hourly: includeHourly, prefetch, preloaded }),
    );
    const warmed = built.filter(Boolean).length;
    return {
      ok: true,
      warmed,
      requested: unique.length,
      cached: prefetch.cached,
      fetched: prefetch.fetched,
      skipped: false,
      duration_ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      warmed: 0,
      requested: unique.length,
      cached: prefetch.cached,
      fetched: prefetch.fetched,
      skipped: false,
      reason: err instanceof Error ? err.message : 'Swing TA pre-warm failed',
      duration_ms: Date.now() - started,
    };
  } finally {
    await releaseCacheLock(PREWARM_LOCK_KEY, lockToken);
  }
}

/**
 * Fire-and-forget pre-warm for the next rotate window (does not block the scan response).
 */
export function scheduleSwingTaPrewarm(
  universeSymbols: string[],
  rotateOffset: number,
  options: { include_hourly?: boolean; concurrency?: number } = {},
): void {
  const symbols = upcomingRotateSymbols(universeSymbols, rotateOffset);
  if (symbols.length === 0) return;
  void prewarmSwingTaCache(symbols, {
    include_hourly: options.include_hourly !== false,
    concurrency: options.concurrency ?? SWING_TA_PREWARM_CONCURRENCY,
    refresh: false,
  }).then((result) => {
    if (!result.ok) {
      console.warn('[swing-auto] TA pre-warm failed:', result.reason);
      return;
    }
    if (result.skipped) return;
    console.info(
      `[swing-auto] TA pre-warm ${result.warmed}/${result.requested} · cache ${result.cached} · fetch ${result.fetched} · ${result.duration_ms}ms`,
    );
  });
}
