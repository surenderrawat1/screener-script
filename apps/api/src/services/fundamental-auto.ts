import { resolveUniverseSymbols } from './universe.js';

import { runLiveScreener, type ScreenerFilters } from '@sv/data-adapters';
import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_TTL } from '@sv/shared';

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
}

export interface LtgAutoState {
  available: boolean;
  saved_at: string | null;
  universe: string;
  max_scan: number;
  tier_changes?: Record<string, unknown>;
  tiers: Record<LtgAutoTierKey, LtgAutoTierHit[]>;
}

const CACHE_PREFIX = 'sv:ltg:auto';

function tierHitFromRow(row: Record<string, unknown>, verdictFallback = ''): LtgAutoTierHit {
  const symbol = String(row.symbol ?? '').trim();
  const verdict = String(row.recommendation ?? row.verdict ?? verdictFallback);
  const strict_verdict = String(row.recommendation ?? row.strict_verdict ?? verdictFallback);
  const decision_label = String(row.recommendation ?? row.decision_label ?? verdictFallback);
  const decision_score =
    typeof row.verify_score === 'number'
      ? row.verify_score
      : typeof row.decision_score === 'number'
        ? row.decision_score
        : typeof row.composite_score === 'number'
          ? row.composite_score
          : 0;

  return {
    symbol,
    verdict,
    strict_verdict,
    decision_label,
    decision_score,
    price: typeof row.price === 'number' ? row.price : null,
    mos: typeof row.mos === 'number' ? row.mos : null,
    quality_score: typeof row.quality_score === 'number' ? row.quality_score : null,
    recommendation_basis: row.recommendation_basis ? String(row.recommendation_basis) : undefined,
    score_basis: row.score_basis ? String(row.score_basis) : undefined,
  };
}

function partitionTiers(rows: Array<Record<string, unknown>>): LtgAutoState['tiers'] {
  const high_conviction: LtgAutoTierHit[] = [];
  const strict_enter: LtgAutoTierHit[] = [];
  const setup_radar: LtgAutoTierHit[] = [];
  const breakout_surge: LtgAutoTierHit[] = [];

  for (const row of rows) {
    const taReady = row.ta_ready === true;
    const crossEma20 = row.ta_cross_above_ema20 === true;
    const crossEma50 = row.ta_cross_above_ema50 === true;
    const macdBullish = row.ta_macd_bullish === true;
    const mos = typeof row.mos === 'number' ? row.mos : null;

    if (taReady) setup_radar.push(tierHitFromRow(row));

    // LTG gate: technical trigger must be present for strict_enter/high_conviction.
    if (crossEma20 || crossEma50) strict_enter.push(tierHitFromRow(row));

    if ((mos != null ? mos >= 20 : false) && crossEma20) high_conviction.push(tierHitFromRow(row));

    if (macdBullish && taReady) breakout_surge.push(tierHitFromRow(row));
  }

  const sortByMos = (a: LtgAutoTierHit, b: LtgAutoTierHit) => (b.mos ?? -999) - (a.mos ?? -999);
  return {
    high_conviction: high_conviction.sort(sortByMos),
    strict_enter: strict_enter.sort(sortByMos),
    setup_radar: setup_radar.sort(sortByMos),
    breakout_surge: breakout_surge.sort(sortByMos),
  };
}

export async function getFundamentalAutoState(
  options: { universe?: string; maxScan?: number } = {},
): Promise<LtgAutoState> {
  const universe = options.universe ?? 'nifty250';
  const max_scan = options.maxScan ?? 250;
  const key = cacheKey(CACHE_PREFIX, `snapshot:${universe}:${max_scan}`);
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

export async function startFundamentalAutoScan(
  options: { universe?: string; maxScan?: number; refresh?: boolean } = {},
): Promise<{ ok: true; snapshot: LtgAutoState } | { ok: false; error: string }> {
  const universe = options.universe ?? 'nifty250';
  const maxScan = options.maxScan ?? 250;
  const refresh = options.refresh ?? false;

  const symbols = await resolveUniverseSymbols(universe, maxScan);
  if (!symbols.length) return { ok: false, error: `No symbols resolved for universe=${universe}` };

  // LTG approximation (minimal viable slice):
  // - Fundamental preset: `moat_compounders`
  // - Technical gate: computed TA fields via `show_ta=1`, then tier partition by crosses/MOS.
  const preset = 'moat_compounders';
  const filters: ScreenerFilters = {
    show_ta: true,
  };

  const run = await runLiveScreener(symbols, preset, filters, undefined, {
    refresh,
    exclude_restricted: true,
  });

  const rows = run.rows as unknown as Array<Record<string, unknown>>;
  const tiers = partitionTiers(rows);

  const snapshot: LtgAutoState = {
    available: true,
    saved_at: new Date().toISOString(),
    universe,
    max_scan: maxScan,
    tiers,
  };

  const key = cacheKey(CACHE_PREFIX, `snapshot:${universe}:${maxScan}`);
  await cacheSetJson(key, snapshot, CACHE_TTL.screener_table ?? 7200);

  return { ok: true, snapshot };
}

