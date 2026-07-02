import { prisma } from '@sv/db';
import {
  defaultRegime,
  getSwingAutoSnapshot,
  mergeHits,
  MODE_FULL,
  MODE_INCREMENTAL,
  saveSwingAutoSnapshot,
  type SwingAutoSnapshot,
  type SwingScanOptions,
} from '@sv/swing';
import { runSwingScan } from './swing-scan.js';
import { currentMarketRegime } from './market-regime.js';

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

export async function getSwingAutoSnapshotDurable(): Promise<SwingAutoSnapshot | null> {
  const redisSnapshot = await getSwingAutoSnapshot();
  if (redisSnapshot) return redisSnapshot;

  const row = await prisma.swingAutoSnapshotArchive.findFirst({
    orderBy: { savedAt: 'desc' },
  });
  if (!row) return null;

  return {
    saved_at: row.savedAt.toISOString(),
    last_full_scan_at: row.lastFullScanAt.toISOString(),
    rotate_offset: row.rotateOffset,
    scan: row.scan as Record<string, unknown>,
    tiers: row.tiers as Record<string, unknown[]>,
    summary: row.summary as Record<string, unknown>,
  };
}

async function persistSnapshot(scanResult: Record<string, unknown>) {
  const snapshot = await saveSwingAutoSnapshot(scanResult);
  await archiveSwingAutoSnapshot(snapshot).catch((err) => {
    console.warn('[swing-auto] snapshot archive failed:', err instanceof Error ? err.message : err);
  });
  return snapshot;
}

export async function executeAutoScanPlan(plan: AutoScanPlan, refresh = false) {
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
    const result = await runSwingScan(symbols, scanOpts, refresh);
    const full = {
      ...result,
      scan_mode: MODE_FULL,
      universe: plan.universe ?? 'nifty250',
      regime,
    };
    await persistSnapshot(full);
    return full;
  }

  const previousHits = Array.isArray(snapshot.scan?.hits)
    ? (snapshot.scan.hits as Record<string, unknown>[])
    : [];
  const refreshSymbols = plan.refresh_symbols ?? symbols;
  const fresh = await runSwingScan(refreshSymbols, scanOpts, refresh);
  const merged = mergeHits(
    previousHits,
    fresh.hits as Record<string, unknown>[],
    refreshSymbols,
    'swing_rank',
  );
  const incremental = {
    ...fresh,
    hits: merged,
    hit_count: merged.length,
    scan_mode: MODE_INCREMENTAL,
    incremental_refreshed: refreshSymbols.length,
    incremental_carried: merged.filter((h) => h.incremental_stale).length,
    rotate_offset: Number(plan.rotate_offset ?? snapshot.rotate_offset ?? 0),
    last_full_scan_at: snapshot.last_full_scan_at,
    universe: plan.universe ?? 'nifty250',
    regime,
  };
  await persistSnapshot(incremental);
  return incremental;
}

export async function resolveAutoScanRegime(refresh = false) {
  try {
    return await currentMarketRegime(refresh);
  } catch {
    return defaultRegime('regime_fetch_failed');
  }
}
