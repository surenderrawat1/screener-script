import { hostname } from 'node:os';
import { prisma, JobStatus } from '@sv/db';
import { runLiveScreener } from '@sv/data-adapters';
import { connectRedis, setJobProgress, setWorkerHeartbeat } from '@sv/cache';
import { createScreenerWorker } from '@sv/jobs';

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

async function main() {
  await connectRedis().catch(() => undefined);

  const worker = createScreenerWorker(async (job) => {
    try {
      await processScreenerJob(job.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await prisma.job.update({
        where: { id: job.data.jobId },
        data: {
          status: JobStatus.failed,
          error: message,
          finishedAt: new Date(),
        },
      });
      throw err;
    }
  });

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  setInterval(() => {
    void setWorkerHeartbeat(WORKER_ID);
  }, 30_000);

  await setWorkerHeartbeat(WORKER_ID);
  console.log(`Worker ${WORKER_ID} started — queues: sv-screener`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
