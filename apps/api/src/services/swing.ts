import { prisma, JobStatus, JobType } from '@sv/db';
import { setJobProgress } from '@sv/cache';
import { enqueueSwingScanJob, shouldRunSwingInBackground } from '@sv/jobs';
import type { SwingScanInput } from '@sv/shared';
import { resolveUniverseSymbols } from './universe.js';
import { runSwingScan } from '@sv/data-adapters';

function scanOptionsFromInput(input: SwingScanInput) {
  return {
    min_verdict: input.min_verdict,
    zone_52w: input.zone_52w,
    gc9_only: input.gc9_only,
    breakout_volume: input.breakout_volume,
    min_rules_passed: input.min_rules_passed,
    require_rules: input.require_rules,
    sort_by: input.sort_by,
  };
}

export async function createSwingScanJob(input: SwingScanInput, userId?: string) {
  let symbols = input.symbols ?? [];
  if (input.universe) {
    symbols = await resolveUniverseSymbols(input.universe, input.maxScan ?? 0);
  }
  if (input.maxScan > 0) {
    symbols = symbols.slice(0, input.maxScan);
  }
  if (symbols.length === 0) {
    throw new Error('No symbols to scan');
  }

  const background = input.background ?? shouldRunSwingInBackground(symbols.length);
  const job = await prisma.job.create({
    data: {
      type: JobType.swing_scan,
      status: JobStatus.pending,
      input: input as object,
      progress: { phase: 'pending', total: symbols.length, processed: 0, passed: 0 },
      createdBy: userId,
    },
  });

  if (background) {
    await enqueueSwingScanJob({ jobId: job.id, input, symbols, userId });
    return { jobId: job.id, background: true, status: 'pending' };
  }

  await prisma.job.update({
    where: { id: job.id },
    data: { status: JobStatus.running, startedAt: new Date() },
  });

  const startedAt = Date.now();
  const result = await runSwingScan(symbols, scanOptionsFromInput(input), input.refresh);
  const durationMs = Date.now() - startedAt;

  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: JobStatus.done,
      result: { ...result, duration_ms: durationMs, universe_size: symbols.length } as object,
      finishedAt: new Date(),
      progress: { phase: 'done', total: symbols.length, processed: symbols.length, passed: result.hits.length },
    },
  });

  await setJobProgress(job.id, {
    phase: 'done',
    total: symbols.length,
    processed: symbols.length,
    passed: result.hits.length,
  });

  return {
    jobId: job.id,
    background: false,
    status: 'done',
    result: { ...result, duration_ms: durationMs, universe_size: symbols.length },
  };
}
