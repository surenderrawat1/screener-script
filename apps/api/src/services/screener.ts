import { randomBytes } from 'node:crypto';
import { prisma, JobStatus, JobType } from '@sv/db';
import { runScreener } from '@sv/core';
import { setJobProgress } from '@sv/cache';
import { enqueueScreenerJob, shouldRunInBackground } from '@sv/jobs';
import type { ScreenerRunInput } from '@sv/shared';
import { resolveUniverseSymbols } from './universe.js';

export async function createScreenerJob(
  input: ScreenerRunInput,
  userId?: string,
): Promise<{ jobId: string; background: boolean; status: string }> {
  const symbols = await resolveUniverseSymbols(input.universe, input.maxScan);
  const taActive = Boolean(input.filters?.show_ta);
  const background =
    input.background ?? shouldRunInBackground(input.maxScan, taActive);

  const job = await prisma.job.create({
    data: {
      type: JobType.screener,
      status: JobStatus.pending,
      input: input as object,
      progress: { phase: 'pending', total: symbols.length, processed: 0, passed: 0 },
      createdBy: userId,
    },
  });

  if (background) {
    await enqueueScreenerJob({
      jobId: job.id,
      input,
      symbols,
      userId,
    });
    return { jobId: job.id, background: true, status: 'pending' };
  }

  await prisma.job.update({
    where: { id: job.id },
    data: { status: JobStatus.running, startedAt: new Date() },
  });

  const rows = runScreener(symbols, input.preset, input.filters as Record<string, number>);
  const result = { rows, total: symbols.length, passed: rows.length };

  await prisma.job.update({
    where: { id: job.id },
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

  await setJobProgress(job.id, {
    phase: 'done',
    total: symbols.length,
    processed: symbols.length,
    passed: rows.length,
  });

  return { jobId: job.id, background: false, status: 'done' };
}

export async function getJob(jobId: string) {
  return prisma.job.findUnique({ where: { id: jobId } });
}

export function newJobId(): string {
  return randomBytes(8).toString('hex');
}
