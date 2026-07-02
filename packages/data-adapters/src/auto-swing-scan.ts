import {
  defaultRegime,
  getSwingAutoSnapshot,
  mergeHits,
  MODE_FULL,
  MODE_INCREMENTAL,
  saveSwingAutoSnapshot,
  type SwingScanOptions,
} from '@sv/swing';
import { runSwingScan } from './swing-scan.js';

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

export async function executeAutoScanPlan(plan: AutoScanPlan, refresh = false) {
  const snapshot = await getSwingAutoSnapshot();
  const symbols = plan.symbols ?? [];
  const scanOpts: SwingScanOptions = {
    min_verdict: plan.min_verdict ?? 'SETUP_PLUS',
    zone_52w: plan.zone_52w ?? 'any',
    breakout_volume: Boolean(plan.breakout_volume),
    regime: plan.regime ?? defaultRegime(),
  };

  if (plan.scan_mode === MODE_FULL || !snapshot) {
    const result = await runSwingScan(symbols, scanOpts, refresh);
    const full = {
      ...result,
      scan_mode: MODE_FULL,
      universe: plan.universe ?? 'nifty250',
    };
    await saveSwingAutoSnapshot(full);
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
  };
  await saveSwingAutoSnapshot(incremental);
  return incremental;
}
