import { prisma, JobStatus, JobType } from '@sv/db';
import { enqueueSwingScanJob, shouldRunSwingInBackground } from '@sv/jobs';
import {
  buildRefreshSet,
  getSwingAutoSnapshot,
  scanInput,
  SCAN_INTERVAL_SEC,
  shouldRunFullScan,
} from '@sv/swing';
import { executeAutoScanPlan, resolveAutoScanRegime, type AutoScanPlan } from './auto-swing-scan.js';
import { openSwingPositionSymbols, resolveUniverseSymbols } from './universe.js';

export async function hasActiveAutoScanJob(): Promise<boolean> {
  const active = await prisma.job.findFirst({
    where: {
      type: JobType.swing_scan,
      status: { in: [JobStatus.pending, JobStatus.running] },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!active) return false;
  const input = (active.input as Record<string, unknown> | null) ?? {};
  return Boolean(input.auto_radar);
}

export async function buildAutoScanPlan(openSymbols?: string[]) {
  const snapshot = await getSwingAutoSnapshot();
  const regime = await resolveAutoScanRegime(false);
  const regimeKey = String(regime.key ?? '');
  const base = scanInput();
  const positions = openSymbols ?? (await openSwingPositionSymbols());

  if (shouldRunFullScan(snapshot, regimeKey)) {
    const symbols = await resolveUniverseSymbols(base.universe, 0);
    return {
      ...base,
      scan_mode: 'full',
      symbols,
      auto_radar: true,
      regime,
    };
  }

  const universeSymbols = await resolveUniverseSymbols(base.universe, 0);
  const refresh = buildRefreshSet(snapshot, universeSymbols, positions);
  return {
    ...base,
    scan_mode: 'incremental',
    refresh_symbols: refresh.symbols,
    rotate_offset: refresh.rotate_offset,
    symbols: refresh.symbols,
    auto_radar: true,
    regime,
    last_full_scan_at: snapshot?.last_full_scan_at,
  };
}

export async function shouldStartAutoScan(): Promise<boolean> {
  if (await hasActiveAutoScanJob()) return false;

  const snapshot = await getSwingAutoSnapshot();
  const savedAt = snapshot?.saved_at ? Date.parse(snapshot.saved_at) : NaN;
  if (Number.isNaN(savedAt)) return true;
  return Date.now() - savedAt >= SCAN_INTERVAL_SEC * 1000;
}

export async function buildForcedFullScanPlan() {
  const regime = await resolveAutoScanRegime(false);
  const base = scanInput();
  const symbols = await resolveUniverseSymbols(base.universe, 0);
  return {
    ...base,
    scan_mode: 'full',
    symbols,
    auto_radar: true,
    regime,
    forced: true,
  };
}

export async function triggerSwingAutoScan(
  userId?: string,
  options: { force?: boolean; full?: boolean } = {},
) {
  if (await hasActiveAutoScanJob()) {
    return { ok: false as const, error: 'A scan is already running — wait for it to finish.' };
  }

  if (!options.force && !(await shouldStartAutoScan())) {
    return { ok: false as const, error: 'Scan not due yet — try again in a few minutes or use force refresh.' };
  }

  const plan =
    options.full || options.force
      ? await buildForcedFullScanPlan()
      : await buildAutoScanPlan();
  const symbols = plan.symbols ?? [];

  if (symbols.length === 0) {
    return { ok: false as const, error: 'No symbols to scan — sync Nifty 250 index CSV in Admin.' };
  }

  if (shouldRunSwingInBackground(symbols.length)) {
    const job = await prisma.job.create({
      data: {
        type: JobType.swing_scan,
        status: JobStatus.pending,
        input: plan as object,
        progress: { phase: 'pending', total: symbols.length, processed: 0, passed: 0 },
        createdBy: userId,
      },
    });
    await enqueueSwingScanJob({ jobId: job.id, input: plan as never, symbols, userId });
    return {
      ok: true as const,
      jobId: job.id,
      background: true,
      scan_mode: plan.scan_mode,
      symbol_count: symbols.length,
    };
  }

  const result = await executeAutoScanPlan(plan as AutoScanPlan, options.force ?? false);
  return {
    ok: true as const,
    background: false,
    scan_mode: plan.scan_mode,
    symbol_count: symbols.length,
    result,
  };
}

export async function tickSwingAutoScan(userId?: string) {
  if (!(await shouldStartAutoScan())) return null;
  return triggerSwingAutoScan(userId);
}
