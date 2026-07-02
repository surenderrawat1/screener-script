import { hostname } from 'node:os';
import { prisma, JobStatus } from '@sv/db';
import { runLiveScreener, runSwingScan } from '@sv/data-adapters';
import { connectRedis, setJobProgress, setWorkerHeartbeat } from '@sv/cache';
import { createScreenerWorker, createSwingScanWorker } from '@sv/jobs';

const WORKER_ID = `${hostname()}-${process.pid}`;

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

  const rows = await runLiveScreener(symbols, input.preset, filters);

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
  };
  symbols: string[];
}) {
  const { jobId, input, symbols } = data;

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date() },
  });

  const result = await runSwingScan(
    symbols,
    {
      min_verdict: input.min_verdict,
      zone_52w: input.zone_52w,
      gc9_only: input.gc9_only,
      breakout_volume: input.breakout_volume,
    },
    input.refresh,
  );

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
        passed: result.hits.length,
      },
    },
  });

  await setJobProgress(jobId, {
    phase: 'done',
    total: symbols.length,
    processed: symbols.length,
    passed: result.hits.length,
  });
}

async function main() {
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

  await setWorkerHeartbeat(WORKER_ID);
  console.log(`Worker ${WORKER_ID} started — queues: sv-screener, sv-swing-scan`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
