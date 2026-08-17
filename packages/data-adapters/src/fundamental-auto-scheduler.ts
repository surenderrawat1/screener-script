import { acquireCacheLock, releaseCacheLock } from '@sv/cache';
import { getSchedules } from '@sv/shared';

import {
  getFundamentalAutoState,
  LTG_AUTO_SCAN_LOCK_KEY,
  runFundamentalAutoScan,
  shouldStartLtgAutoScan,
  type LtgAutoScanResult,
} from './fundamental-auto-scan.js';
const RUN_LOCK_TTL_SEC = 3600;

export interface LtgAutoTickResult extends LtgAutoScanResult {
  universe: string;
  max_scan: number;
}

export async function tickFundamentalAutoScan(): Promise<LtgAutoTickResult | null> {
  const schedules = getSchedules();
  const cfg = schedules.intraday.ltg_auto_scan;
  if (cfg?.enabled === false) return null;

  const universe = cfg?.universe ?? 'nifty250';
  const maxScan = cfg?.max_scan ?? 250;
  const intervalSec = Math.max(60, cfg?.interval_sec ?? 900);

  if (!(await shouldStartLtgAutoScan({ universe, maxScan, intervalSec }))) {
    return null;
  }

  const lockToken = await acquireCacheLock(LTG_AUTO_SCAN_LOCK_KEY, RUN_LOCK_TTL_SEC);
  if (!lockToken) return null;

  try {
    if (!(await shouldStartLtgAutoScan({ universe, maxScan, intervalSec }))) {
      return null;
    }

    const result = await runFundamentalAutoScan({
      universe,
      maxScan,
      refresh: false,
      lockToken,
    });

    if (!result.ok) return null;

    return {
      ...result.result,
      universe,
      max_scan: maxScan,
    };
  } finally {
    await releaseCacheLock(LTG_AUTO_SCAN_LOCK_KEY, lockToken);
  }
}

export async function ltgAutoScanDueInSec(
  options: { universe?: string; maxScan?: number; intervalSec?: number } = {},
): Promise<number> {
  const state = await getFundamentalAutoState({
    universe: options.universe,
    maxScan: options.maxScan,
  });
  const intervalSec = options.intervalSec ?? 900;
  if (!state.saved_at) return 0;

  const savedAt = Date.parse(state.saved_at);
  if (Number.isNaN(savedAt)) return 0;
  return Math.max(0, intervalSec - Math.floor((Date.now() - savedAt) / 1000));
}
