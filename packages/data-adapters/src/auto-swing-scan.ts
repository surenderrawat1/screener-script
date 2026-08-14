import { prisma } from '@sv/db';
import {
  defaultRegime,
  getSwingAutoSnapshot,
  mergeHits,
  MODE_FULL,
  MODE_INCREMENTAL,
  saveSwingAutoSnapshot,
  warmSwingAutoSnapshot,
  actionableScanHits,
  evaluateScanSla,
  type SwingAutoSnapshot,
  type SwingScanOptions,
} from '@sv/swing';
import { runSwingScan, type SwingScanProgress } from './swing-scan.js';
import { currentMarketRegime } from './market-regime.js';
import { scheduleSwingTaPrewarm } from './swing-ta-prewarm.js';
import { resolveUniverseSymbols } from './universe.js';
import { attachBacktestTruthToHits } from './auto-backtest-truth.js';

export type { SwingScanProgress };

/** Phase C2 — retain recent archives (48h) and always the newest 100 rows. */
export const SWING_AUTO_ARCHIVE_MAX_AGE_HOURS = 48;
export const SWING_AUTO_ARCHIVE_MAX_ROWS = 100;

export type AutoScanPlan = {
  universe?: string;
  scan_mode?: string;
  symbols?: string[];
  refresh_symbols?: string[];
  rotate_offset?: number;
  min_verdict?: SwingScanOptions['min_verdict'];
  zone_52w?: string;
  breakout_volume?: boolean;
  regime?: Record<string, unknown> | null;
  last_full_scan_at?: string;
};

export async function archiveSwingAutoSnapshot(snapshot: SwingAutoSnapshot): Promise<void> {
  const regimeKey = String((snapshot.scan.regime as Record<string, unknown> | undefined)?.key ?? '');
  await prisma.swingAutoSnapshotArchive.create({
    data: {
      savedAt: new Date(snapshot.saved_at),
      lastFullScanAt: new Date(snapshot.last_full_scan_at),
      scanMode: String(snapshot.scan.scan_mode ?? 'full'),
      rotateOffset: snapshot.rotate_offset,
      regimeKey: regimeKey || null,
      scan: snapshot.scan as object,
      tiers: snapshot.tiers as object,
      summary: snapshot.summary as object,
    },
  });
}

/**
 * Delete archive rows older than maxAgeHours that are also outside the newest maxRows.
 * Keeps last 48h ∪ last 100 (Phase C2).
 */
export async function pruneSwingAutoSnapshotArchives(
  options: { maxAgeHours?: number; maxRows?: number } = {},
): Promise<{ deleted: number; kept_floor: number; cutoff: string }> {
  const maxAgeHours = Math.max(
    1,
    Math.floor(options.maxAgeHours ?? SWING_AUTO_ARCHIVE_MAX_AGE_HOURS),
  );
  const maxRows = Math.max(1, Math.floor(options.maxRows ?? SWING_AUTO_ARCHIVE_MAX_ROWS));
  const cutoff = new Date(Date.now() - maxAgeHours * 3_600_000);

  const newest = await prisma.swingAutoSnapshotArchive.findMany({
    orderBy: { savedAt: 'desc' },
    take: maxRows,
    select: { id: true },
  });
  const keepIds = newest.map((row) => row.id);

  const result = await prisma.swingAutoSnapshotArchive.deleteMany({
    where: {
      AND: [
        { savedAt: { lt: cutoff } },
        keepIds.length > 0 ? { id: { notIn: keepIds } } : {},
      ],
    },
  });

  return {
    deleted: result.count,
    kept_floor: keepIds.length,
    cutoff: cutoff.toISOString(),
  };
}

export async function getSwingAutoSnapshotDurable(): Promise<SwingAutoSnapshot | null> {
  const redisSnapshot = await getSwingAutoSnapshot();
  if (redisSnapshot) return redisSnapshot;

  const row = await prisma.swingAutoSnapshotArchive.findFirst({
    orderBy: { savedAt: 'desc' },
  });
  if (!row) return null;

  const snapshot: SwingAutoSnapshot = {
    saved_at: row.savedAt.toISOString(),
    last_full_scan_at: row.lastFullScanAt.toISOString(),
    rotate_offset: row.rotateOffset,
    scan: row.scan as Record<string, unknown>,
    tiers: row.tiers as Record<string, unknown[]>,
    summary: row.summary as Record<string, unknown>,
  };

  // Phase C1 — Redis flush recovery: re-warm so the next state read is <500ms.
  await warmSwingAutoSnapshot(snapshot).catch((err) => {
    console.warn(
      '[swing-auto] Redis warm after DB fallback failed:',
      err instanceof Error ? err.message : err,
    );
  });

  return snapshot;
}

async function persistSnapshot(scanResult: Record<string, unknown>) {
  const previous = await getSwingAutoSnapshot().catch(() => null);
  const snapshot = await saveSwingAutoSnapshot(scanResult);
  await archiveSwingAutoSnapshot(snapshot).catch((err) => {
    console.warn('[swing-auto] snapshot archive failed:', err instanceof Error ? err.message : err);
  });
  void pruneSwingAutoSnapshotArchives().catch((err) => {
    console.warn('[swing-auto] snapshot prune failed:', err instanceof Error ? err.message : err);
  });
  // Email + webhook for High Conviction (HOT) tier additions.
  void import('./swing-radar-alerts.js')
    .then(({ dispatchSwingRadarAlerts }) => dispatchSwingRadarAlerts(snapshot, previous))
    .then((result) => {
      if (result.email.signals > 0) {
        console.info(
          `[swing-radar-email] signals=${result.email.signals} sent=${result.email.sent}${result.email.reason ? ` (${result.email.reason})` : ''}`,
        );
      }
      if (result.webhook.added > 0) {
        console.info(
          `[swing-radar-webhook] added=${result.webhook.added} sent=${result.webhook.sent}${result.webhook.reason ? ` (${result.webhook.reason})` : ''}`,
        );
      }
      if (result.whatsapp.added > 0) {
        console.info(
          `[swing-radar-whatsapp] added=${result.whatsapp.added} sent=${result.whatsapp.sent}${result.whatsapp.reason ? ` (${result.whatsapp.reason})` : ''}`,
        );
      }
    })
    .catch((err) => {
      console.warn('[swing-radar-alerts] failed:', err instanceof Error ? err.message : err);
    });
  return snapshot;
}

export async function executeAutoScanPlan(
  plan: AutoScanPlan,
  refresh = false,
  onProgress?: (progress: SwingScanProgress) => void | Promise<void>,
) {
  const startedAt = Date.now();
  const snapshot = await getSwingAutoSnapshot();
  const symbols = plan.symbols ?? [];
  const regime = plan.regime ?? (await currentMarketRegime(refresh));
  const scanOpts: SwingScanOptions = {
    min_verdict: plan.min_verdict ?? 'SETUP_PLUS',
    zone_52w: plan.zone_52w ?? 'any',
    breakout_volume: Boolean(plan.breakout_volume),
    regime,
  };

  if (plan.scan_mode === MODE_FULL || !snapshot) {
    // Accuracy-first full scan: E9 hourly confirmation must be present before
    // a fresh hit can enter a strict/high-conviction or paper-trading tier.
    const result = await runSwingScan(
      symbols,
      { ...scanOpts, include_hourly: true, onProgress },
      refresh,
    );
    const hitsWithTruth = await attachBacktestTruthToHits(
      (result.hits as Record<string, unknown>[]) ?? [],
    );
    const elapsedSec = Math.round(((Date.now() - startedAt) / 1000) * 10) / 10;
    const sla = evaluateScanSla(MODE_FULL, elapsedSec, symbols.length);
    const full = {
      ...result,
      hits: hitsWithTruth,
      hit_count: hitsWithTruth.length,
      scan_mode: MODE_FULL,
      universe: plan.universe ?? 'nifty250',
      universe_size: symbols.length,
      regime,
      hourly_on_scan: true,
      include_hourly: true,
      rotate_offset: 0,
      backtest_truth_preload: hitsWithTruth.filter((h) => h.backtest_truth).length,
      scan_elapsed_sec: Number(result.elapsed_sec ?? 0),
      elapsed_sec: elapsedSec,
      sla,
    };
    await persistSnapshot(full);
    // Phase B3 — low-priority warm of the first incremental rotate windows.
    scheduleSwingTaPrewarm(symbols, 0);
    return full;
  }

  const previousHits = Array.isArray(snapshot.scan?.hits)
    ? (snapshot.scan.hits as Record<string, unknown>[])
    : [];
  const refreshSymbols = plan.refresh_symbols ?? symbols;
  const nextRotate = Number(plan.rotate_offset ?? snapshot.rotate_offset ?? 0);
  // Incremental set is bounded (≤ MAX_REFRESH_SYMBOLS) — enable hourly for E9 confirmation.
  const fresh = await runSwingScan(
    refreshSymbols,
    { ...scanOpts, include_hourly: true, onProgress },
    refresh,
  );
  const freshWithTruth = await attachBacktestTruthToHits(
    (fresh.hits as Record<string, unknown>[]) ?? [],
  );
  const merged = mergeHits(
    previousHits,
    freshWithTruth,
    refreshSymbols,
    'swing_rank',
  );
  const elapsedSec = Math.round(((Date.now() - startedAt) / 1000) * 10) / 10;
  const sla = evaluateScanSla(MODE_INCREMENTAL, elapsedSec, refreshSymbols.length);
  const incremental = {
    ...fresh,
    hits: merged,
    hit_count: actionableScanHits(merged).length,
    scan_mode: MODE_INCREMENTAL,
    incremental_refreshed: refreshSymbols.length,
    incremental_carried: merged.filter((h) => h.incremental_stale).length,
    rotate_offset: nextRotate,
    last_full_scan_at: snapshot.last_full_scan_at,
    universe: plan.universe ?? 'nifty250',
    universe_size: symbols.length,
    regime,
    hourly_on_scan: true,
    include_hourly: true,
    backtest_truth_preload: merged.filter((h) => h.backtest_truth).length,
    scan_elapsed_sec: Number(fresh.elapsed_sec ?? 0),
    elapsed_sec: elapsedSec,
    sla,
  };
  await persistSnapshot(incremental);
  // Phase B3 — warm the *next* rotate window while this incremental result is already live.
  void resolveUniverseSymbols(String(plan.universe ?? 'nifty250'), 0)
    .then((universe) => {
      scheduleSwingTaPrewarm(universe, nextRotate);
    })
    .catch((err) => {
      console.warn(
        '[swing-auto] TA pre-warm universe resolve failed:',
        err instanceof Error ? err.message : err,
      );
    });
  return incremental;
}

export async function resolveAutoScanRegime(refresh = false) {
  try {
    return await currentMarketRegime(refresh);
  } catch {
    return defaultRegime('regime_fetch_failed');
  }
}
