import { rankHits } from './ranker.js';
import type { SwingScanHit } from './types.js';

export const FULL_SCAN_INTERVAL_SEC = 1800;
export const ROTATE_BATCH = 30;
export const MAX_REFRESH_SYMBOLS = 120;
export const MODE_FULL = 'full';
export const MODE_INCREMENTAL = 'incremental';

export function shouldRunFullScan(snapshot: Record<string, unknown> | null, currentRegimeKey?: string | null): boolean {
  if (!snapshot) return true;

  const lastFull = Date.parse(String(snapshot.last_full_scan_at ?? snapshot.saved_at ?? ''));
  if (Number.isNaN(lastFull)) return true;
  if (Date.now() - lastFull >= FULL_SCAN_INTERVAL_SEC * 1000) return true;

  if (currentRegimeKey) {
    const prevKey = String((snapshot.scan as Record<string, unknown> | undefined)?.regime
      ? ((snapshot.scan as Record<string, unknown>).regime as Record<string, unknown>).key
      : '');
    if (prevKey && prevKey !== currentRegimeKey) return true;
  }

  const prevHits = (snapshot.scan as Record<string, unknown> | undefined)?.hits;
  if (!Array.isArray(prevHits) || prevHits.length === 0) return true;
  return false;
}

export function hitSymbolsFromSnapshot(snapshot: Record<string, unknown> | null): string[] {
  if (!snapshot) return [];
  const hits = (snapshot.scan as Record<string, unknown> | undefined)?.hits;
  if (!Array.isArray(hits)) return [];
  return hits
    .map((h) => String((h as Record<string, unknown>).symbol ?? '').toUpperCase())
    .filter(Boolean);
}

export function buildRefreshSet(
  snapshot: Record<string, unknown> | null,
  universeSymbols: string[],
  openSymbols: string[],
  batchSize = ROTATE_BATCH,
) {
  const set = new Set<string>();
  for (const sym of openSymbols) if (sym) set.add(sym.toUpperCase());
  for (const sym of hitSymbolsFromSnapshot(snapshot)) set.add(sym);

  const offset = Number(snapshot?.rotate_offset ?? 0);
  const total = universeSymbols.length;
  const rotate: string[] = [];
  let nextOffset = offset;

  if (total > 0) {
    const batch = Math.max(1, Math.min(batchSize, total));
    for (let i = 0; i < batch; i++) {
      const sym = String(universeSymbols[(offset + i) % total] ?? '').toUpperCase();
      if (sym) {
        set.add(sym);
        rotate.push(sym);
      }
    }
    nextOffset = (offset + batch) % total;
  }

  let symbols = [...set];
  if (symbols.length > MAX_REFRESH_SYMBOLS) symbols = symbols.slice(0, MAX_REFRESH_SYMBOLS);

  return {
    symbols,
    rotate_offset: nextOffset,
    components: { open: openSymbols, hits: hitSymbolsFromSnapshot(snapshot), rotate },
  };
}

export function mergeHits(
  previousHits: Record<string, unknown>[],
  freshHits: Record<string, unknown>[],
  refreshedSymbols: string[],
  sortBy = 'swing_rank',
) {
  const refreshSet = new Set(refreshedSymbols.map((s) => s.toUpperCase()).filter(Boolean));
  const freshBySym = new Map<string, Record<string, unknown>>();
  for (const hit of freshHits) {
    const sym = String(hit.symbol ?? '').toUpperCase();
    if (sym) freshBySym.set(sym, hit);
  }

  const merged: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const hit of previousHits) {
    const sym = String(hit.symbol ?? '').toUpperCase();
    if (!sym || refreshSet.has(sym)) continue;
    merged.push({ ...hit, incremental_stale: true });
    seen.add(sym);
  }

  for (const sym of refreshSet) {
    if (seen.has(sym) || !freshBySym.has(sym)) continue;
    merged.push({ ...freshBySym.get(sym)!, incremental_stale: false });
    seen.add(sym);
  }

  if (sortBy === 'swing_rank') {
    return rankHits(merged as SwingScanHit[]) as Record<string, unknown>[];
  }
  return merged;
}

export function nextFullScanInSec(snapshot: Record<string, unknown> | null): number {
  if (!snapshot) return 0;
  const lastFull = Date.parse(String(snapshot.last_full_scan_at ?? snapshot.saved_at ?? ''));
  if (Number.isNaN(lastFull)) return 0;
  return Math.max(0, FULL_SCAN_INTERVAL_SEC - Math.floor((Date.now() - lastFull) / 1000));
}
