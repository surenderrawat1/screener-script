import { prisma, JobStatus, JobType } from '@sv/db';
import {
  dateKeyInTimezone,
  getDataPolicy,
  getSchedules,
  isDailyCronDue,
  type ScheduleStep,
} from '@sv/shared';
import { syncAllIndicesFromDirectory } from './index-sync.js';
import { defaultIndicesDir } from './indices-dir.js';
import { fetchStockData } from './stock-data-fetcher.js';
import { fetchScreenerRatios } from './screener-in.js';
import { currentMarketRegime } from './market-regime.js';
import { warmMorningBriefing } from './morning-prewarm.js';
import { openSwingPositionSymbols, resolveUniverseSymbols } from './universe.js';
import { scanChartPatternsBatch } from './chart-pattern-scan.js';

export interface DailySyncStepResult {
  id: string;
  action: string;
  ok: boolean;
  duration_ms: number;
  detail?: Record<string, unknown>;
  error?: string;
}

export interface DailySyncResult {
  ok: boolean;
  job_id: string;
  started_at: string;
  finished_at: string;
  steps: DailySyncStepResult[];
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function collectPrefetchSymbols(): Promise<string[]> {
  const policy = getDataPolicy();
  const symbols = new Set<string>();

  if (!policy.prefetch.enabled) {
    return [];
  }

  for (const universeKey of policy.prefetch.universes) {
    const rows = await resolveUniverseSymbols(universeKey, 0);
    for (const sym of rows) symbols.add(sym.toUpperCase());
  }

  if (policy.prefetch.include_open_positions) {
    for (const sym of await openSwingPositionSymbols()) {
      symbols.add(sym.toUpperCase());
    }
  }

  return [...symbols].sort();
}

async function runStep(step: ScheduleStep): Promise<DailySyncStepResult> {
  const started = Date.now();
  const base = { id: step.id, action: step.action };

  try {
    switch (step.action) {
      case 'sync_indices_from_dir': {
        const dir = defaultIndicesDir();
        const results = await syncAllIndicesFromDirectory(dir);
        const okCount = results.filter((r) => r.ok).length;
        return {
          ...base,
          ok: okCount > 0,
          duration_ms: Date.now() - started,
          detail: { indicesDir: dir, synced: okCount, total: results.length, results },
          error: okCount === 0 ? 'No indices synced' : undefined,
        };
      }

      case 'prefetch_ohlc': {
        const symbols = await collectPrefetchSymbols();
        const policy = getDataPolicy();
        const batch = policy.prefetch.max_symbols_per_batch;
        const delay = policy.prefetch.delay_ms_between_batches;
        let fetched = 0;
        let failed = 0;

        for (let i = 0; i < symbols.length; i += batch) {
          const chunk = symbols.slice(i, i + batch);
          await Promise.all(
            chunk.map(async (sym) => {
              try {
                const res = await fetchStockData(sym, { refresh: true });
                if (res.success) fetched++;
                else failed++;
              } catch {
                failed++;
              }
            }),
          );
          if (i + batch < symbols.length && delay > 0) {
            await sleep(delay);
          }
        }

        return {
          ...base,
          ok: fetched > 0 || symbols.length === 0,
          duration_ms: Date.now() - started,
          detail: { symbols: symbols.length, fetched, failed },
        };
      }

      case 'prefetch_screener_rows': {
        const symbols = await collectPrefetchSymbols();
        const policy = getDataPolicy();
        const batch = policy.prefetch.max_symbols_per_batch;
        const delay = policy.prefetch.delay_ms_between_batches;
        let fetched = 0;
        let failed = 0;

        for (let i = 0; i < symbols.length; i += batch) {
          const chunk = symbols.slice(i, i + batch);
          await Promise.all(
            chunk.map(async (sym) => {
              try {
                const res = await fetchScreenerRatios(sym, true);
                if (res) fetched++;
                else failed++;
              } catch {
                failed++;
              }
            }),
          );
          if (i + batch < symbols.length && delay > 0) {
            await sleep(delay);
          }
        }

        return {
          ...base,
          ok: true,
          duration_ms: Date.now() - started,
          detail: { symbols: symbols.length, fetched, failed },
        };
      }

      case 'warm_market_regime': {
        const regime = await currentMarketRegime(true);
        return {
          ...base,
          ok: Boolean(regime.key),
          duration_ms: Date.now() - started,
          detail: { regime_key: regime.key, label: regime.label },
        };
      }

      case 'warm_morning_briefing': {
        const warmed = await warmMorningBriefing(true);
        return {
          ...base,
          ok: warmed.ok,
          duration_ms: Date.now() - started,
          detail: {
            regime_key: warmed.regime_key,
            etf_hit_count: warmed.etf_hit_count,
            nifty_charts: warmed.nifty_charts,
          },
          error: warmed.error,
        };
      }

      case 'scan_chart_patterns': {
        const symbols = await collectPrefetchSymbols();
        const result = await scanChartPatternsBatch(symbols, {
          refresh: false,
          trigger: 'daily_sync',
        });
        return {
          ...base,
          ok: result.symbols_ok > 0 || symbols.length === 0,
          duration_ms: Date.now() - started,
          detail: { ...result },
          error:
            result.symbols_failed > 0 && result.symbols_ok === 0
              ? 'All chart pattern scans failed'
              : undefined,
        };
      }

      default:
        return {
          ...base,
          ok: false,
          duration_ms: Date.now() - started,
          error: `Unknown action: ${step.action}`,
        };
    }
  } catch (err) {
    return {
      ...base,
      ok: false,
      duration_ms: Date.now() - started,
      error: err instanceof Error ? err.message : 'Step failed',
    };
  }
}

export async function hasCompletedDailySyncToday(timezone?: string): Promise<boolean> {
  const tz = timezone ?? getSchedules().daily_sync.timezone;
  const today = dateKeyInTimezone(tz);

  const last = await prisma.job.findFirst({
    where: { type: JobType.daily_close, status: JobStatus.done },
    orderBy: { finishedAt: 'desc' },
  });

  if (!last?.finishedAt) return false;
  return dateKeyInTimezone(tz, last.finishedAt) === today;
}

export async function hasActiveDailySyncJob(): Promise<boolean> {
  const active = await prisma.job.findFirst({
    where: {
      type: JobType.daily_close,
      status: { in: [JobStatus.pending, JobStatus.running] },
    },
  });
  return Boolean(active);
}

export async function getDailySyncStatus() {
  const schedules = getSchedules();
  const last = await prisma.job.findFirst({
    where: { type: JobType.daily_close },
    orderBy: { createdAt: 'desc' },
  });

  const completedToday = await hasCompletedDailySyncToday(schedules.daily_sync.timezone);
  const dueNow = isDailyCronDue(
    schedules.daily_sync.cron,
    schedules.daily_sync.timezone,
  );

  return {
    enabled: schedules.daily_sync.enabled,
    cron: schedules.daily_sync.cron,
    timezone: schedules.daily_sync.timezone,
    completed_today: completedToday,
    due_now: dueNow,
    active: await hasActiveDailySyncJob(),
    last_job: last
      ? {
          id: last.id,
          status: last.status,
          created_at: last.createdAt.toISOString(),
          finished_at: last.finishedAt?.toISOString() ?? null,
          error: last.error,
          result: last.result,
        }
      : null,
  };
}

export interface DailySyncAccepted {
  accepted: true;
  ok: true;
  job_id: string;
  started_at: string;
  message: string;
}

async function executeDailySyncJob(
  jobId: string,
  startedAt: Date,
  enabledSteps: ScheduleStep[],
): Promise<DailySyncResult> {
  const steps: DailySyncStepResult[] = [];

  try {
    for (let i = 0; i < enabledSteps.length; i++) {
      const step = enabledSteps[i]!;
      await prisma.job.update({
        where: { id: jobId },
        data: {
          progress: {
            phase: 'running',
            step: i + 1,
            total: enabledSteps.length,
            current_step: step.id,
          },
        },
      });

      const result = await runStep(step);
      steps.push(result);
    }

    const ok = steps.every((s) => s.ok);
    const finishedAt = new Date();
    const payload: DailySyncResult = {
      ok,
      job_id: jobId,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      steps,
      error: ok ? undefined : 'One or more steps failed',
    };

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: ok ? JobStatus.done : JobStatus.failed,
        result: payload as object,
        finishedAt,
        error: ok ? null : payload.error,
        progress: { phase: 'done', step: enabledSteps.length, total: enabledSteps.length },
      },
    });

    return payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Daily sync failed';
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.failed,
        error: message,
        finishedAt: new Date(),
        result: { steps } as object,
      },
    });
    throw err;
  }
}

export async function runDailySync(options: {
  force?: boolean;
  userId?: string;
  trigger?: 'manual' | 'scheduler' | 'cli';
  background: true;
}): Promise<DailySyncAccepted>;
export async function runDailySync(options?: {
  force?: boolean;
  userId?: string;
  trigger?: 'manual' | 'scheduler' | 'cli';
  background?: false;
}): Promise<DailySyncResult>;
export async function runDailySync(options: {
  force?: boolean;
  userId?: string;
  trigger?: 'manual' | 'scheduler' | 'cli';
  /** When true, return immediately after creating the job (Admin HTTP path). */
  background?: boolean;
} = {}): Promise<DailySyncResult | DailySyncAccepted> {
  const schedules = getSchedules();

  if (!schedules.daily_sync.enabled && !options.force) {
    throw new Error('Daily sync is disabled in schedules config.');
  }

  if (!options.force) {
    if (await hasActiveDailySyncJob()) {
      throw new Error('Daily sync already running.');
    }
    if (
      schedules.daily_sync.skip_if_completed_today &&
      (await hasCompletedDailySyncToday(schedules.daily_sync.timezone))
    ) {
      throw new Error('Daily sync already completed today.');
    }
  } else if (await hasActiveDailySyncJob()) {
    throw new Error('Daily sync already running.');
  }

  const startedAt = new Date();
  const enabledSteps = schedules.daily_sync.steps.filter((s) => s.enabled);
  const job = await prisma.job.create({
    data: {
      type: JobType.daily_close,
      status: JobStatus.running,
      input: {
        trigger: options.trigger ?? 'manual',
        force: Boolean(options.force),
        background: Boolean(options.background),
      },
      createdBy: options.userId,
      startedAt,
      progress: { phase: 'running', step: 0, total: enabledSteps.length },
    },
  });

  if (options.background) {
    void executeDailySyncJob(job.id, startedAt, enabledSteps).catch((err) => {
      console.error('[daily-sync] background job failed', job.id, err);
    });
    return {
      accepted: true,
      ok: true,
      job_id: job.id,
      started_at: startedAt.toISOString(),
      message: 'Daily sync started — poll /api/v1/admin/sync/status for progress.',
    };
  }

  return executeDailySyncJob(job.id, startedAt, enabledSteps);
}

export async function tickDailySync(): Promise<DailySyncResult | null> {
  const schedules = getSchedules();
  if (!schedules.daily_sync.enabled) return null;
  if (schedules.daily_sync.skip_if_completed_today && (await hasCompletedDailySyncToday())) {
    return null;
  }
  if (await hasActiveDailySyncJob()) return null;
  if (!isDailyCronDue(schedules.daily_sync.cron, schedules.daily_sync.timezone)) {
    return null;
  }

  return runDailySync({ trigger: 'scheduler' });
}
