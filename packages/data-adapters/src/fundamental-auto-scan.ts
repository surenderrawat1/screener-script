import { acquireCacheLock, cacheGetJson, cacheKey, cacheSetJson, releaseCacheLock } from '@sv/cache';
import {
  enrichLtgRow,
  ltgGuidanceFromSummary,
  passesRecommendationTiers,
  type EnrichedLtgRow,
  type LtgGuidance,
  type ScreenerFilters,
} from '@sv/core';
import { CACHE_TTL } from '@sv/shared';

import { runLiveScreener } from './screener-run.js';
import { resolveUniverseSymbols } from './universe.js';

export type LtgAutoTierKey = 'high_conviction' | 'strict_enter' | 'setup_radar' | 'breakout_surge';

export interface LtgAutoTierHit {
  symbol: string;
  verdict: string;
  strict_verdict: string;
  decision_label: string;
  decision_score: number;
  price: number | null;
  mos: number | null;
  quality_score: number | null;
  recommendation_basis?: string;
  score_basis?: string;
  decision_action?: string;
  recommendation_tier?: string;
  ltg_rank?: number;
}

export interface LtgAutoState {
  available: boolean;
  saved_at: string | null;
  universe: string;
  max_scan: number;
  tier_changes?: Record<string, unknown>;
  tiers: Record<LtgAutoTierKey, LtgAutoTierHit[]>;
  summary?: {
    scanned: number;
    passed: number;
    buy_eligible: number;
  };
  guidance?: LtgGuidance;
}

export interface LtgAutoScanResult {
  ok: true;
  snapshot: LtgAutoState;
  scanned: number;
  buy_eligible: number;
  duration_ms: number;
}

const CACHE_PREFIX = 'sv:ltg:auto';
export const LTG_AUTO_SCAN_LOCK_KEY = cacheKey(CACHE_PREFIX, 'scan:lock');
const RUN_LOCK_TTL_SEC = 3600;
const BUY_ELIGIBLE_TIERS = ['strong_buy', 'buy', 'buy_staggered'] as const;

export function ltgAutoSnapshotKey(universe: string, maxScan: number): string {
  return cacheKey(CACHE_PREFIX, `snapshot:${universe}:${maxScan}`);
}

function tierHitFromRow(row: Record<string, unknown>, enriched: EnrichedLtgRow): LtgAutoTierHit {
  const symbol = String(row.symbol ?? '').trim();
  const verdict = String(row.recommendation ?? row.verdict ?? '');
  return {
    symbol,
    verdict,
    strict_verdict: verdict,
    decision_label: enriched.decision_label,
    decision_score: enriched.decision_score,
    price: typeof row.price === 'number' ? row.price : null,
    mos: typeof row.mos === 'number' ? row.mos : null,
    quality_score: typeof row.composite_score === 'number' ? row.composite_score : null,
    recommendation_basis: row.recommendation_basis ? String(row.recommendation_basis) : undefined,
    score_basis: row.score_basis ? String(row.score_basis) : undefined,
    decision_action: enriched.decision_action,
    recommendation_tier: enriched.recommendation_tier,
    ltg_rank: enriched.ltg_rank,
  };
}

function partitionTiers(rows: Array<Record<string, unknown>>): LtgAutoState['tiers'] {
  const high_conviction: LtgAutoTierHit[] = [];
  const strict_enter: LtgAutoTierHit[] = [];
  const setup_radar: LtgAutoTierHit[] = [];
  const breakout_surge: LtgAutoTierHit[] = [];

  for (const row of rows) {
    const enriched = enrichLtgRow(row);
    const hit = tierHitFromRow(row, enriched);
    const taReady = row.ta_ready === true;
    const crossEma20 = row.ta_cross_above_ema20 === true;
    const crossEma50 = row.ta_cross_above_ema50 === true;
    const macdBullish = row.ta_macd_bullish === true;
    const mos = typeof row.mos === 'number' ? row.mos : null;
    const sales = typeof row.sales_yoy === 'number' ? row.sales_yoy : 0;

    if (enriched.high_conviction || ((mos ?? 0) >= 20 && crossEma20)) {
      high_conviction.push(hit);
    }

    if (
      (enriched.decision_action === 'CORE_LTG' || enriched.decision_action === 'ACCUMULATE') &&
      (crossEma20 || crossEma50)
    ) {
      strict_enter.push(hit);
    }

    if (enriched.decision_action === 'WATCH_LT' || taReady) {
      setup_radar.push(hit);
    }

    if (macdBullish && taReady && sales >= 8) {
      breakout_surge.push(hit);
    }
  }

  const sortByRank = (a: LtgAutoTierHit, b: LtgAutoTierHit) =>
    (b.ltg_rank ?? 0) - (a.ltg_rank ?? 0) || (b.mos ?? -999) - (a.mos ?? -999);

  return {
    high_conviction: high_conviction.sort(sortByRank),
    strict_enter: strict_enter.sort(sortByRank),
    setup_radar: setup_radar.sort(sortByRank),
    breakout_surge: breakout_surge.sort(sortByRank),
  };
}

export async function getFundamentalAutoState(
  options: { universe?: string; maxScan?: number } = {},
): Promise<LtgAutoState> {
  const universe = options.universe ?? 'nifty250';
  const max_scan = options.maxScan ?? 250;
  const key = ltgAutoSnapshotKey(universe, max_scan);
  const cached = await cacheGetJson<LtgAutoState>(key);
  if (cached?.available) return cached;

  return {
    available: false,
    saved_at: null,
    universe,
    max_scan,
    tiers: { high_conviction: [], strict_enter: [], setup_radar: [], breakout_surge: [] },
  };
}

export async function shouldStartLtgAutoScan(
  options: { universe?: string; maxScan?: number; intervalSec?: number; force?: boolean } = {},
): Promise<boolean> {
  if (options.force) return true;

  const state = await getFundamentalAutoState({
    universe: options.universe,
    maxScan: options.maxScan,
  });
  const intervalSec = options.intervalSec ?? 900;
  if (!state.saved_at) return true;

  const savedAt = Date.parse(state.saved_at);
  if (Number.isNaN(savedAt)) return true;
  return Date.now() - savedAt >= intervalSec * 1000;
}

export async function runFundamentalAutoScan(
  options: {
    universe?: string;
    maxScan?: number;
    refresh?: boolean;
    lockToken?: string | null;
  } = {},
): Promise<{ ok: true; result: LtgAutoScanResult } | { ok: false; error: string }> {
  const universe = options.universe ?? 'nifty250';
  const maxScan = options.maxScan ?? 250;
  const refresh = options.refresh ?? false;
  const ownLock = options.lockToken == null;
  let lockToken = options.lockToken ?? null;

  if (ownLock) {
    lockToken = await acquireCacheLock(LTG_AUTO_SCAN_LOCK_KEY, RUN_LOCK_TTL_SEC);
    if (!lockToken) {
      return { ok: false, error: 'LTG auto scan already running' };
    }
  }

  const started = Date.now();
  try {
    const symbols = await resolveUniverseSymbols(universe, maxScan);
    if (!symbols.length) {
      return { ok: false, error: `No symbols resolved for universe=${universe}` };
    }

    const preset = 'cfa_ltg_auto';
    const filters: ScreenerFilters = { show_ta: true };

    const run = await runLiveScreener(symbols, preset, filters, undefined, {
      refresh,
      exclude_restricted: true,
    });

    const allRows = run.rows as unknown as Array<Record<string, unknown>>;
    const buyEligible = allRows.filter((row) =>
      passesRecommendationTiers(String(row.recommendation ?? ''), [...BUY_ELIGIBLE_TIERS]),
    );
    const tiers = partitionTiers(buyEligible);

    const summary = {
      scanned: run.scanned,
      passed: allRows.length,
      buy_eligible: buyEligible.length,
    };

    const guidance = ltgGuidanceFromSummary({
      passed: buyEligible.length,
      scanned: run.scanned,
      high_conviction: tiers.high_conviction.length,
      strict_enter: tiers.strict_enter.length,
    });

    const snapshot: LtgAutoState = {
      available: true,
      saved_at: new Date().toISOString(),
      universe,
      max_scan: maxScan,
      tiers,
      summary,
      guidance,
    };

    await cacheSetJson(ltgAutoSnapshotKey(universe, maxScan), snapshot, CACHE_TTL.screener_table ?? 7200);

    return {
      ok: true,
      result: {
        ok: true,
        snapshot,
        scanned: run.scanned,
        buy_eligible: buyEligible.length,
        duration_ms: Date.now() - started,
      },
    };
  } finally {
    if (ownLock && lockToken) {
      await releaseCacheLock(LTG_AUTO_SCAN_LOCK_KEY, lockToken);
    }
  }
}

export async function startFundamentalAutoScan(
  options: { universe?: string; maxScan?: number; refresh?: boolean } = {},
): Promise<{ ok: true; snapshot: LtgAutoState } | { ok: false; error: string }> {
  const result = await runFundamentalAutoScan(options);
  if (!result.ok) return result;
  return { ok: true, snapshot: result.result.snapshot };
}
