import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, getCacheTtl } from '@sv/shared';
import { summarizeScan } from './auto-screener.js';
import { categorizeHits } from './auto-decision.js';

const SNAPSHOT_KEY = 'snapshot';

export type SwingAutoSnapshot = {
  saved_at: string;
  last_full_scan_at: string;
  rotate_offset: number;
  scan: Record<string, unknown>;
  tiers: Record<string, unknown[]>;
  summary: Record<string, unknown>;
};

export async function getSwingAutoSnapshot(): Promise<SwingAutoSnapshot | null> {
  const key = cacheKey(CACHE_PREFIX.SWING_AUTO, SNAPSHOT_KEY);
  const row = await cacheGetJson<SwingAutoSnapshot>(key);
  return row ?? null;
}

export async function saveSwingAutoSnapshot(scanResult: Record<string, unknown>): Promise<SwingAutoSnapshot> {
  const hits = Array.isArray(scanResult.hits) ? (scanResult.hits as Record<string, unknown>[]) : [];
  const regime = (scanResult.regime as Record<string, unknown> | undefined) ?? null;
  const isFull = String(scanResult.scan_mode ?? 'full') === 'full';
  const prev = await getSwingAutoSnapshot();
  const lastFull = isFull
    ? new Date().toISOString()
    : String(scanResult.last_full_scan_at ?? prev?.last_full_scan_at ?? new Date().toISOString());

  const tiers = categorizeHits(hits, regime, false);
  const snapshot: SwingAutoSnapshot = {
    saved_at: new Date().toISOString(),
    last_full_scan_at: lastFull,
    rotate_offset: Number(scanResult.rotate_offset ?? prev?.rotate_offset ?? 0),
    scan: scanResult,
    tiers,
    summary: summarizeScan(scanResult, hits, regime),
  };

  const key = cacheKey(CACHE_PREFIX.SWING_AUTO, SNAPSHOT_KEY);
  await cacheSetJson(key, snapshot, getCacheTtl().swing_auto_snapshot);
  return snapshot;
}
