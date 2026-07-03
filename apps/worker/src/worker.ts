import './load-env.js';

import { hostname } from 'node:os';
import { prisma, JobStatus } from '@sv/db';
import { runLiveScreener, executeAutoScanPlan, runSwingScan, tickSwingAutoScan, tickDailySync, tickMorningPrewarm } from '@sv/data-adapters';
import { connectRedis, setJobProgress, setWorkerHeartbeat } from '@sv/cache';
import { createScreenerWorker, createSwingScanWorker } from '@sv/jobs';
import { initAppConfig } from '@sv/shared';

const WORKER_ID = `${hostname()}-${process.pid}`;
const AUTO_SCAN_TICK_MS = 60_000;

async function processScreenerJob(data: {
  jobId: string;
  input: { preset?: string; filters?: Record<string, unknown> };
  symbols: string[];
}) {
  const { jobId, input, symbols } = data;
  const filters = (input.filters ?? {}) as Record<string, number>;

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date() },
  });

  const rows = await runLiveScreener(symbols, input.preset, filters, async (progress) => {
    const snapshot = {
      phase: 'analyze',
      total: progress.total,
      processed: progress.processed,
      passed: progress.passed,
    };
    await setJobProgress(jobId, snapshot);
    if (progress.processed % 10 === 0 || progress.processed === progress.total) {
      await prisma.job.update({
        where: { id: jobId },
        data: { progress: snapshot },
      });
    }
  });

  const result = { rows, total: symbols.length, passed: rows.length };

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.done,
      result: result as object,
      finishedAt: new Date(),
      progress: {
        phase: 'done',
        total: symbols.length,
        processed: symbols.length,
        passed: rows.length,
      },
    },
  });

  await setJobProgress(jobId, {
    phase: 'done',
    total: symbols.length,
    processed: symbols.length,
    passed: rows.length,
  });
}

async function processSwingScanJob(data: {
  jobId: string;
  input: {
    min_verdict?: 'ENTER' | 'SETUP_PLUS' | 'WATCH' | 'ALL';
    zone_52w?: string;
    gc9_only?: boolean;
    breakout_volume?: boolean;
    refresh?: boolean;
    auto_radar?: boolean;
    scan_mode?: string;
    symbols?: string[];
    refresh_symbols?: string[];
    rotate_offset?: number;
    universe?: string;
    regime?: Record<string, unknown>;
  };
  symbols: string[];
}) {
  const { jobId, input, symbols } = data;

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date() },
  });

  const result = input.auto_radar
    ? await executeAutoScanPlan(
        {
          ...input,
          symbols: input.symbols ?? symbols,
        },
        Boolean(input.refresh),
      )
    : await runSwingScan(
        symbols,
        {
          min_verdict: input.min_verdict,
          zone_52w: input.zone_52w,
          gc9_only: input.gc9_only,
          breakout_volume: input.breakout_volume,
          regime: input.regime,
        },
        input.refresh,
      );

  const hits = Array.isArray((result as { hits?: unknown }).hits)
    ? (result as { hits: unknown[] }).hits
    : [];

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.done,
      result: result as object,
      finishedAt: new Date(),
      progress: {
        phase: 'done',
        total: symbols.length,
        processed: symbols.length,
        passed: hits.length,
      },
    },
  });

  await setJobProgress(jobId, {
    phase: 'done',
    total: symbols.length,
    processed: symbols.length,
    passed: hits.length,
  });
}

async function main() {
  await initAppConfig();
  await connectRedis().catch(() => undefined);

  const screenerWorker = createScreenerWorker(async (job) => {
    try {
      await processScreenerJob(job.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await prisma.job.update({
        where: { id: job.data.jobId },
        data: { status: JobStatus.failed, error: message, finishedAt: new Date() },
      });
      throw err;
    }
  });

  const swingWorker = createSwingScanWorker(async (job) => {
    try {
      await processSwingScanJob(job.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await prisma.job.update({
        where: { id: job.data.jobId },
        data: { status: JobStatus.failed, error: message, finishedAt: new Date() },
      });
      throw err;
    }
  });

  screenerWorker.on('failed', (job, err) => console.error(`Screener job ${job?.id} failed:`, err.message));
  swingWorker.on('failed', (job, err) => console.error(`Swing job ${job?.id} failed:`, err.message));

  setInterval(() => {
    void setWorkerHeartbeat(WORKER_ID);
  }, 30_000);

  setInterval(() => {
    void tickSwingAutoScan().catch((err) => {
      console.error('Swing auto-scan tick failed:', err instanceof Error ? err.message : err);
    });
  }, AUTO_SCAN_TICK_MS);

  setInterval(() => {
    void tickDailySync().then((result) => {
      if (result) {
        console.log(`Daily sync completed — job ${result.job_id} (${result.ok ? 'ok' : 'failed'})`);
      }
    }).catch((err) => {
      console.error('Daily sync tick failed:', err instanceof Error ? err.message : err);
    });
  }, AUTO_SCAN_TICK_MS);

  setInterval(() => {
    void tickMorningPrewarm().then((result) => {
      if (result) {
        console.log(
          `Morning pre-warm completed — regime ${result.regime_key ?? '—'}, ETF hits ${result.etf_hit_count}`,
        );
      }
    }).catch((err) => {
      console.error('Morning pre-warm tick failed:', err instanceof Error ? err.message : err);
    });
  }, AUTO_SCAN_TICK_MS);

  await setWorkerHeartbeat(WORKER_ID);
  console.log(`Worker ${WORKER_ID} started — queues: sv-screener, sv-swing-scan (auto tick ${AUTO_SCAN_TICK_MS / 1000}s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
