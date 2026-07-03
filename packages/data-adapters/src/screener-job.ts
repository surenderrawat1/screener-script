import { JobStatus, prisma } from '@sv/db';
import { setJobProgress } from '@sv/cache';
import { runLiveScreener, type ScreenerFilters, type ScreenerRunOptions } from './screener-run.js';

export async function executeScreenerJob(
  jobId: string,
  symbols: string[],
  preset?: string,
  filters: ScreenerFilters = {},
  options: ScreenerRunOptions = {},
) {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date() },
  });

  const run = await runLiveScreener(symbols, preset, filters, async (progress) => {
    const snapshot = {
      phase: 'analyze',
      total: progress.total,
      processed: progress.processed,
      passed: progress.passed,
    };
    await setJobProgress(jobId, snapshot);
    if (progress.processed % 5 === 0 || progress.processed === progress.total) {
      await prisma.job.update({
        where: { id: jobId },
        data: { progress: snapshot },
      });
    }
  }, options);

  const result = {
    rows: run.rows,
    total: symbols.length,
    scanned: run.scanned,
    passed: run.rows.length,
    restricted_skipped: run.restricted_skipped,
    cache_hits: run.cache_hits,
    exchange_list_as_of: run.exchange_list_as_of,
  };

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.done,
      result: result as object,
      finishedAt: new Date(),
      progress: {
        phase: 'done',
        total: run.scanned,
        processed: run.scanned,
        passed: run.rows.length,
      },
    },
  });

  await setJobProgress(jobId, {
    phase: 'done',
    total: run.scanned,
    processed: run.scanned,
    passed: run.rows.length,
  });

  return result;
}
