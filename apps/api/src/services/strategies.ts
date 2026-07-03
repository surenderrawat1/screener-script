import { JobStatus, JobType, prisma } from '@sv/db';
import { setJobProgress } from '@sv/cache';
import {
  STRATEGY_STYLE_LABELS,
  getStrategy,
  listStrategies,
  readyStrategyCount,
} from '@sv/swing';
import { runStrategy, type StrategyRunInput } from '@sv/data-adapters';
import { resolveUniverseSymbols } from './universe.js';
import { getJob } from './screener.js';

export { getJob };

export function listTradingStrategies(style?: string | null) {
  const strategies = listStrategies(style);
  return {
    style_labels: STRATEGY_STYLE_LABELS,
    ready_count: readyStrategyCount(),
    total: strategies.length,
    strategies,
  };
}

export function getTradingStrategy(key: string) {
  return getStrategy(key);
}

function toRunnerInput(input: StrategyRunInput & { background?: boolean }): StrategyRunInput {
  const { background: _bg, ...rest } = input;
  return rest;
}

function shouldStrategyRunInBackground(
  engine: string,
  symbolCount: number,
  force?: boolean,
): boolean {
  if (force) return true;
  if (engine === 'swing') return symbolCount > 25;
  if (engine === 'hybrid') return symbolCount > 40;
  return symbolCount > 80;
}

export async function createStrategyRun(
  input: StrategyRunInput & { background?: boolean },
  userId?: string,
) {
  const def = getStrategy(input.strategy);
  if (!def) throw new Error(`Unknown strategy: ${input.strategy}`);

  const universe = input.universe?.trim() || def.universe_default;
  const maxScan =
    input.maxScan != null && input.maxScan > 0 ? input.maxScan : def.max_scan_default || 200;
  const symbols = await resolveUniverseSymbols(universe, maxScan > 0 ? maxScan : 2000);
  const scanCount =
    input.maxScan != null && input.maxScan > 0
      ? Math.min(input.maxScan, symbols.length)
      : symbols.length;

  const background = shouldStrategyRunInBackground(def.engine, scanCount, input.background);

  if (!background) {
    const result = await runStrategy(toRunnerInput(input));
    return { background: false as const, status: 'done' as const, result };
  }

  const job = await prisma.job.create({
    data: {
      type: JobType.screener,
      status: JobStatus.pending,
      input: { kind: 'strategy', ...input } as object,
      progress: { phase: 'pending', total: scanCount, processed: 0, passed: 0 },
      createdBy: userId,
    },
  });

  void executeStrategyJob(job.id, input).catch(async (err) => {
    const message = err instanceof Error ? err.message : 'Strategy failed';
    await prisma.job.update({
      where: { id: job.id },
      data: { status: JobStatus.failed, error: message, finishedAt: new Date() },
    });
  });

  return { jobId: job.id, background: true as const, status: 'pending' as const };
}

async function executeStrategyJob(jobId: string, input: StrategyRunInput) {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date() },
  });

  await setJobProgress(jobId, { phase: 'analyze', total: 1, processed: 0, passed: 0 });

  const result = await runStrategy(toRunnerInput(input));

  const passed =
    result.engine === 'screener'
      ? result.passed
      : result.engine === 'hybrid'
        ? result.hits.length
        : result.hits.length;

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.done,
      result: result as object,
      finishedAt: new Date(),
      progress: { phase: 'done', total: result.scanned, processed: result.scanned, passed },
    },
  });

  await setJobProgress(jobId, {
    phase: 'done',
    total: result.scanned,
    processed: result.scanned,
    passed,
  });

  return result;
}

export async function executeStrategy(input: StrategyRunInput) {
  return runStrategy(input);
}
