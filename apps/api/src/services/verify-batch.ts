import { randomBytes } from 'node:crypto';
import { prisma, JobStatus, JobType } from '@sv/db';
import { enqueueVerifyBatchJob } from '@sv/jobs';
import { resolveUniverseSymbols } from './universe.js';
import type { VerifyBatchJobPayload } from '@sv/jobs';

import { z } from 'zod';
import { verifyBatchSchema } from '@sv/shared';

export type VerifyBatchInput = z.infer<typeof verifyBatchSchema>;

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '').split('.')[0] ?? '';
}

export async function createVerifyBatchJob(
  input: VerifyBatchInput,
  userId?: string,
): Promise<{ jobId: string; background: boolean; status: string }> {
  const refresh = Boolean(input.refresh);

  const symbols =
    input.symbols && input.symbols.length > 0
      ? input.symbols.map(normalizeSymbol).filter(Boolean)
      : input.universe
        ? await resolveUniverseSymbols(input.universe, input.maxScan ?? 200)
        : [];

  const job = await prisma.job.create({
    data: {
      type: JobType.verify_batch,
      status: JobStatus.pending,
      input: { refresh } as object,
      progress: { phase: 'pending', total: symbols.length, processed: 0, passed: 0 },
      createdBy: userId,
    },
  });

  const payload: VerifyBatchJobPayload = {
    jobId: job.id,
    symbols,
    input: { refresh },
    userId,
  };

  await enqueueVerifyBatchJob(payload);

  return { jobId: job.id, background: true, status: 'pending' };
}

export async function getJob(jobId: string) {
  return prisma.job.findUnique({ where: { id: jobId } });
}

export function newJobId(): string {
  return randomBytes(8).toString('hex');
}

