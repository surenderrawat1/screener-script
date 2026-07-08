import { prisma, JobStatus, JobType } from '@sv/db';
import {
  attachBacktestTruthToHits,
  buildSymbolContext,
  getSwingAutoSnapshotDurable,
  triggerSwingAutoScan as runAutoScan,
  hasActiveAutoScanJob,
  currentMarketRegime,
  liveQuoteForSymbol,
} from '@sv/data-adapters';
import { nseSession } from '@sv/shared';
import {
  buildState,
  buildPositionsBlock,
  checkAddPosition,
  scanInput,
  profile,
  refreshPosition,
  trailRatchetFields,
  SCAN_INTERVAL_SEC,
  nextFullScanInSec,
  MAX_OPEN_POSITIONS,
  HEAT_BLOCK_PCT,
  portfolioHeatPct,
} from '@sv/swing';
import { listSwingPositions, persistPositionTrailRatchet } from './swing-positions.js';

export { triggerSwingAutoScan, shouldStartAutoScan, buildAutoScanPlan } from '@sv/data-adapters';

export async function getSwingAutoState(
  userId: string,
  options: { live?: boolean; positions?: boolean; include_carried?: boolean } = {},
) {
  const includePositions = options.positions !== false;
  const includeCarried = Boolean(options.include_carried);
  const snapshot = await getSwingAutoSnapshotDurable();
  let scanResult =
    snapshot?.scan ??
    (await latestSwingScanResult()) ?? {
      hits: [],
      hit_count: 0,
      scanned: 0,
      engine_version: 'v3.9-gc9',
    };

  const regime = (scanResult.regime as Record<string, unknown> | undefined) ?? null;
  const rawHits = Array.isArray(scanResult.hits) ? (scanResult.hits as Record<string, unknown>[]) : [];
  const hitsWithTruth = await attachBacktestTruthToHits(rawHits);
  const backtestAttached = hitsWithTruth.filter((h) => h.backtest_truth).length;
  scanResult = { ...scanResult, hits: hitsWithTruth };

  const { positions: dbPositions } = await listSwingPositions(userId, 'open');
  const heatPct = portfolioHeatPct(
    dbPositions.map((p) => ({
      entry_price: p.entry_price,
      stop_loss: p.stop_loss,
      shares: p.shares,
    })),
  );
  const livePositions = includePositions
    ? await refreshOpenPositions(dbPositions, Boolean(options.live), regime)
    : [];
  const positionsForTierOverlay = includePositions ? livePositions : dbPositions;

  const state = buildState(scanResult, positionsForTierOverlay, regime, {
    includeCarried,
    backtestAttached,
  });

  if (!includePositions) {
    state.positions = {
      ...state.positions,
      open: [],
      count: dbPositions.length,
      heat_pct: heatPct,
    };
  }

  const savedAtMs = snapshot?.saved_at ? Date.parse(snapshot.saved_at) : NaN;
  const nextScanInSec = Number.isNaN(savedAtMs)
    ? 0
    : Math.max(0, SCAN_INTERVAL_SEC - Math.floor((Date.now() - savedAtMs) / 1000));

  const blocksRegime = Boolean(regime?.blocks_strict_enter);
  const canAdd =
    dbPositions.length < MAX_OPEN_POSITIONS && heatPct < HEAT_BLOCK_PCT && !blocksRegime;

  const scanning = await hasActiveAutoScanJob();

  return {
    ...state,
    session: nseSession(),
    snapshot: snapshot
      ? {
          saved_at: snapshot.saved_at,
          last_full_scan_at: snapshot.last_full_scan_at,
          scan_mode: String((snapshot.scan as Record<string, unknown>)?.scan_mode ?? ''),
          summary: snapshot.summary,
        }
      : null,
    timing: {
      next_scan_in_sec: nextScanInSec,
      next_full_scan_in_sec: nextFullScanInSec(snapshot),
      scan_interval_sec: SCAN_INTERVAL_SEC,
    },
    scan_status: {
      active: scanning,
      label: scanning ? 'scanning' : snapshot ? 'live' : 'idle',
    },
    portfolio_risk: {
      heat_pct: heatPct,
      open_count: dbPositions.length,
      max_positions: MAX_OPEN_POSITIONS,
      max_heat_pct: HEAT_BLOCK_PCT,
      can_add: canAdd,
      blocked_reason: !canAdd
        ? blocksRegime
          ? 'Strong bear regime — new entries blocked'
          : dbPositions.length >= MAX_OPEN_POSITIONS
            ? `Max ${MAX_OPEN_POSITIONS} open positions`
            : heatPct >= HEAT_BLOCK_PCT
              ? `Portfolio heat ${heatPct.toFixed(1)}% ≥ ${HEAT_BLOCK_PCT}%`
              : null
        : null,
    },
  };
}

export async function getSwingAutoPositions(userId: string, options: { live?: boolean } = {}) {
  const snapshot = await getSwingAutoSnapshotDurable();
  const scanResult =
    snapshot?.scan ??
    (await latestSwingScanResult()) ?? {
      hits: [],
    };
  const regime = (scanResult.regime as Record<string, unknown> | undefined) ?? null;
  const hits = Array.isArray(scanResult.hits) ? (scanResult.hits as Record<string, unknown>[]) : [];
  const { positions } = await listSwingPositions(userId, 'open');
  const livePositions = await refreshOpenPositions(positions, Boolean(options.live), regime);
  return buildPositionsBlock(livePositions, hits, regime);
}

async function latestSwingScanResult() {
  const latestJob = await prisma.job.findFirst({
    where: { type: JobType.swing_scan, status: JobStatus.done },
    orderBy: { finishedAt: 'desc' },
  });
  return (latestJob?.result as Record<string, unknown> | null) ?? null;
}

const POSITION_REFRESH_CONCURRENCY = 5;

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export async function refreshOpenPositions(
  positions: Array<Record<string, unknown>>,
  refresh = false,
  regime?: Record<string, unknown> | null,
) {
  const resolvedRegime = regime ?? (await currentMarketRegime(refresh));

  return mapConcurrent(positions, POSITION_REFRESH_CONCURRENCY, async (pos) => {
    const symbol = String(pos.symbol ?? '');
    const ctx = await buildSymbolContext(symbol, refresh, { include_hourly: true });
    if (!ctx) {
      return {
        ...pos,
        current_price: null,
        gain_pct: null,
        exit_verdict: 'HOLD',
        exit_triggers: [],
        position_action: 'REVIEW',
        action_label: 'Review',
        action_reasons: ['Live chart unavailable'],
      };
    }
    const priceFromBars = Number(ctx.ta.ta_price ?? ctx.bars[ctx.bars.length - 1]?.close ?? 0);
    let price = priceFromBars;
    let usedLiveQuote = false;
    const session = nseSession();
    if (refresh || session.live_quotes) {
      const live = await liveQuoteForSymbol(symbol, refresh);
      if (live != null && live > 0) {
        price = live;
        usedLiveQuote = session.live_quotes;
      }
    }
    const asOfDate = String(ctx.ta.as_of_date ?? ctx.ta.ta_as_of_date ?? '');
    const positionInput = {
      id: String(pos.id ?? ''),
      symbol,
      status: String(pos.status ?? 'open'),
      entry_price: Number(pos.entry_price ?? 0),
      entry_date: String(pos.entry_date ?? ''),
      shares: pos.shares as number | null | undefined,
      stop_loss: pos.stop_loss as number | null | undefined,
      profit_target: pos.profit_target as number | null | undefined,
      highest_since_entry: pos.highest_since_entry as number | null | undefined,
      trailed_stop_loss: pos.trailed_stop_loss as number | null | undefined,
    };
    const refreshed = refreshPosition(positionInput, {
      ta: ctx.ta,
      price,
      bars: ctx.bars,
      hourlyBars: ctx.hourlyBars,
      regime: resolvedRegime,
    });

    const ratchet = trailRatchetFields(positionInput, refreshed);
    if (positionInput.id && (ratchet.highest_since_entry != null || ratchet.trailed_stop_loss != null)) {
      await persistPositionTrailRatchet(positionInput.id, ratchet);
    }

    return {
      ...refreshed,
      id: pos.id,
      notes: pos.notes,
      source: pos.source,
      highest_since_entry: ratchet.highest_since_entry ?? refreshed.highest_since_entry,
      trailed_stop_loss: ratchet.trailed_stop_loss ?? positionInput.trailed_stop_loss,
      ok: true,
      live: usedLiveQuote,
      as_of_date: asOfDate,
      quote_time: usedLiveQuote ? session.ist_time : '',
      data_source: usedLiveQuote ? 'yahoo_live' : 'yahoo_daily',
      stale: false,
    };
  });
}

export function getSwingAutoProfile() {
  return { profile: profile(), scan_input: scanInput() };
}

export async function validateSwingAddPosition(
  userId: string,
  input: Record<string, unknown>,
  _clientRegime?: Record<string, unknown> | null,
) {
  const snapshot = await getSwingAutoSnapshotDurable();
  const scanRegime = (snapshot?.scan as Record<string, unknown> | undefined)?.regime as
    | Record<string, unknown>
    | undefined;
  const regime = scanRegime ?? (await currentMarketRegime(false));
  const { positions } = await listSwingPositions(userId, 'open');
  return checkAddPosition(input, positions, regime);
}

export async function startSwingAutoScan(
  userId: string,
  options: { force?: boolean; full?: boolean } = {},
) {
  return runAutoScan(userId, options);
}
