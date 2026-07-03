import { prisma, JobStatus, JobType } from '@sv/db';
import { buildSymbolContext, getSwingAutoSnapshotDurable, triggerSwingAutoScan as runAutoScan, hasActiveAutoScanJob } from '@sv/data-adapters';
import {
  buildState,
  buildPositionsBlock,
  checkAddPosition,
  scanInput,
  profile,
  refreshPosition,
  SCAN_INTERVAL_SEC,
  nextFullScanInSec,
  MAX_OPEN_POSITIONS,
  HEAT_BLOCK_PCT,
  portfolioHeatPct,
} from '@sv/swing';
import { listSwingPositions } from './swing-positions.js';

export { triggerSwingAutoScan, shouldStartAutoScan, buildAutoScanPlan } from '@sv/data-adapters';

export async function getSwingAutoState(
  userId: string,
  options: { live?: boolean; positions?: boolean } = {},
) {
  const includePositions = options.positions !== false;
  const snapshot = await getSwingAutoSnapshotDurable();
  const scanResult =
    snapshot?.scan ??
    (await latestSwingScanResult()) ?? {
      hits: [],
      hit_count: 0,
      scanned: 0,
      engine_version: 'v3.9-gc9',
    };

  const regime = (scanResult.regime as Record<string, unknown> | undefined) ?? null;
  const { positions: dbPositions } = await listSwingPositions(userId, 'open');
  const heatPct = portfolioHeatPct(
    dbPositions.map((p) => ({
      entry_price: p.entry_price,
      stop_loss: p.stop_loss,
      shares: p.shares,
    })),
  );
  const livePositions = includePositions
    ? await refreshOpenPositions(dbPositions, Boolean(options.live))
    : [];

  const state = buildState(scanResult, livePositions, regime);

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
  const livePositions = await refreshOpenPositions(positions, Boolean(options.live));
  return buildPositionsBlock(livePositions, hits, regime);
}

async function latestSwingScanResult() {
  const latestJob = await prisma.job.findFirst({
    where: { type: JobType.swing_scan, status: JobStatus.done },
    orderBy: { finishedAt: 'desc' },
  });
  return (latestJob?.result as Record<string, unknown> | null) ?? null;
}

export async function refreshOpenPositions(
  positions: Array<Record<string, unknown>>,
  refresh = false,
) {
  const rows: Record<string, unknown>[] = [];
  for (const pos of positions) {
    const symbol = String(pos.symbol ?? '');
    const ctx = await buildSymbolContext(symbol, refresh);
    if (!ctx) {
      rows.push({
        ...pos,
        current_price: null,
        gain_pct: null,
        exit_verdict: 'HOLD',
        exit_triggers: [],
        position_action: 'REVIEW',
        action_label: 'Review',
        action_reasons: ['Live chart unavailable'],
      });
      continue;
    }
    const price = Number(ctx.ta.ta_price ?? ctx.bars[ctx.bars.length - 1]?.close ?? 0);
    const refreshed = refreshPosition(
      {
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
      },
      { ta: ctx.ta, price, bars: ctx.bars },
    );
    rows.push({
      ...refreshed,
      id: pos.id,
      notes: pos.notes,
      source: pos.source,
      ok: true,
    });
  }
  return rows;
}

export function getSwingAutoProfile() {
  return { profile: profile(), scan_input: scanInput() };
}

export async function validateSwingAddPosition(
  userId: string,
  input: Record<string, unknown>,
  regime?: Record<string, unknown> | null,
) {
  const { positions } = await listSwingPositions(userId, 'open');
  return checkAddPosition(input, positions, regime ?? null);
}

export async function startSwingAutoScan(userId: string) {
  return runAutoScan(userId);
}
