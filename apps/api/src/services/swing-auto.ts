import { prisma, JobStatus, JobType } from '@sv/db';
import { buildSymbolContext, getSwingAutoSnapshotDurable, triggerSwingAutoScan as runAutoScan } from '@sv/data-adapters';
import {
  buildState,
  checkAddPosition,
  scanInput,
  profile,
  refreshPosition,
} from '@sv/swing';
import { listSwingPositions } from './swing-positions.js';

export { triggerSwingAutoScan, shouldStartAutoScan, buildAutoScanPlan } from '@sv/data-adapters';

export async function getSwingAutoState(userId: string) {
  const snapshot = await getSwingAutoSnapshotDurable();
  const scanResult =
    snapshot?.scan ??
    (await latestSwingScanResult()) ?? {
      hits: [],
      hit_count: 0,
      scanned: 0,
      engine_version: 'v3.9-gc9',
    };

  const { positions } = await listSwingPositions(userId, 'open');
  const livePositions = await refreshOpenPositions(positions);

  const regime = (scanResult.regime as Record<string, unknown> | undefined) ?? null;
  const state = buildState(scanResult, livePositions, regime);
  return {
    ...state,
    snapshot: snapshot
      ? {
          saved_at: snapshot.saved_at,
          last_full_scan_at: snapshot.last_full_scan_at,
          summary: snapshot.summary,
        }
      : null,
  };
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
    rows.push(refreshed);
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
