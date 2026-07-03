import { randomBytes } from 'node:crypto';
import { prisma, JobStatus, JobType } from '@sv/db';
import { enqueueScreenerJob, shouldRunInBackground } from '@sv/jobs';
import { executeScreenerJob } from '@sv/data-adapters';
import type { ScreenerRunInput } from '@sv/shared';
import { resolveUniverseSymbols } from './universe.js';

export async function createScreenerJob(
  input: ScreenerRunInput,
  userId?: string,
): Promise<{ jobId: string; background: boolean; status: string }> {
  const symbols = await resolveUniverseSymbols(input.universe, input.maxScan);
  const taActive = Boolean(input.filters?.show_ta);
  const useQueue = input.background ?? shouldRunInBackground(input.maxScan, taActive);
  const filters = (input.filters ?? {}) as Record<string, number>;
  const runOptions = {
    exclude_restricted: input.exclude_restricted !== false,
    refresh: Boolean(input.refresh),
  };

  const job = await prisma.job.create({
    data: {
      type: JobType.screener,
      status: JobStatus.pending,
      input: input as object,
      progress: { phase: 'pending', total: symbols.length, processed: 0, passed: 0 },
      createdBy: userId,
    },
  });

  if (useQueue) {
    await enqueueScreenerJob({
      jobId: job.id,
      input,
      symbols,
      userId,
    });
    return { jobId: job.id, background: true, status: 'pending' };
  }

  void executeScreenerJob(job.id, symbols, input.preset, filters, runOptions).catch(async (err) => {
    const message = err instanceof Error ? err.message : 'Screener failed';
    await prisma.job.update({
      where: { id: job.id },
      data: { status: JobStatus.failed, error: message, finishedAt: new Date() },
    });
  });

  return { jobId: job.id, background: true, status: 'pending' };
}

export async function getJob(jobId: string) {
  return prisma.job.findUnique({ where: { id: jobId } });
}

export function newJobId(): string {
  return randomBytes(8).toString('hex');
}
