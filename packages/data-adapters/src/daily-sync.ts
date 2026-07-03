import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma, JobStatus, JobType } from '@sv/db';
import {
  dateKeyInTimezone,
  getDataPolicy,
  getSchedules,
  isDailyCronDue,
  type ScheduleStep,
} from '@sv/shared';
import { syncAllIndicesFromDirectory } from './index-sync.js';
import { fetchStockData } from './stock-data-fetcher.js';
import { fetchScreenerRatios } from './screener-in.js';
import { currentMarketRegime } from './market-regime.js';
import { warmMorningBriefing } from './morning-prewarm.js';
import { openSwingPositionSymbols, resolveUniverseSymbols } from './universe.js';

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

function defaultIndicesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return (
    process.env.INDICES_DIR ??
    resolve(here, '../../../../stock-verifier/data/indices')
  );
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

export async function runDailySync(options: {
  force?: boolean;
  userId?: string;
  trigger?: 'manual' | 'scheduler' | 'cli';
} = {}): Promise<DailySyncResult> {
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
  }

  const startedAt = new Date();
  const job = await prisma.job.create({
    data: {
      type: JobType.daily_close,
      status: JobStatus.running,
      input: { trigger: options.trigger ?? 'manual', force: Boolean(options.force) },
      createdBy: options.userId,
      startedAt,
      progress: { phase: 'running', step: 0, total: 0 },
    },
  });

  const steps: DailySyncStepResult[] = [];
  const enabledSteps = schedules.daily_sync.steps.filter((s) => s.enabled);

  try {
    for (let i = 0; i < enabledSteps.length; i++) {
      const step = enabledSteps[i]!;
      await prisma.job.update({
        where: { id: job.id },
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
      job_id: job.id,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      steps,
      error: ok ? undefined : 'One or more steps failed',
    };

    await prisma.job.update({
      where: { id: job.id },
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
      where: { id: job.id },
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
