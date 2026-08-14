import { JobStatus, JobType, prisma } from '@sv/db';
import { setJobProgress } from '@sv/cache';
import {
  STRATEGY_STYLE_LABELS,
  SWING_TIER_A_UNIVERSE_ID,
  type SwingScanOptions,
  type StrategyDefinition,
  getStrategy,
  listStrategies,
} from '@sv/swing';
import {
  executeScreenerJob,
  runLiveScreener,
  runStrategy,
  runSwingScan,
  type ScreenerFilters,
  type StrategyRunInput,
} from '@sv/data-adapters';
import { resolveUniverseSymbols } from './universe.js';
import { getJob } from './screener.js';

export { getJob };

const USER_SCREENER_PRESET_KEY_PREFIX = 'user_screener_preset:';
const USER_SCREENER_DEFAULT_UNIVERSE = 'nifty500';
const USER_SCREENER_DEFAULT_MAX_SCAN = 500;

const USER_SWING_RULE_PROFILE_KEY_PREFIX = 'user_swing_rule_profile:';
const USER_SWING_RULE_DEFAULT_UNIVERSE = SWING_TIER_A_UNIVERSE_ID;
const USER_SWING_RULE_DEFAULT_MAX_SCAN = 300;

function isUserScreenerPresetKey(key: string): boolean {
  return key.startsWith(USER_SCREENER_PRESET_KEY_PREFIX);
}

function userScreenerPresetIdFromKey(key: string): string {
  return key.slice(USER_SCREENER_PRESET_KEY_PREFIX.length);
}

function isUserSwingRuleProfileKey(key: string): boolean {
  return key.startsWith(USER_SWING_RULE_PROFILE_KEY_PREFIX);
}

function userSwingRuleProfileIdFromKey(key: string): string {
  return key.slice(USER_SWING_RULE_PROFILE_KEY_PREFIX.length);
}

function customScreenerPresetToStrategyDef(preset: {
  id: string;
  name: string;
}): StrategyDefinition {
  return {
    key: `${USER_SCREENER_PRESET_KEY_PREFIX}${preset.id}`,
    label: preset.name,
    description: 'Custom screener preset',
    style: 'positional',
    engine: 'screener',
    horizon: 'Custom',
    universe_default: USER_SCREENER_DEFAULT_UNIVERSE,
    max_scan_default: USER_SCREENER_DEFAULT_MAX_SCAN,
    icon: 'U',
    ready: true,
  };
}

export async function listTradingStrategies(style?: string | null, userId?: string) {
  const system = listStrategies(style);

  const includeScreenerCustom = !style || style === 'all' || style === 'positional';
  const includeSwingCustom = !style || style === 'all' || style === 'swing';

  if (!userId || (!includeScreenerCustom && !includeSwingCustom)) {
    return {
      style_labels: STRATEGY_STYLE_LABELS,
      ready_count: system.filter((s) => s.ready).length,
      total: system.length,
      strategies: system,
    };
  }

  const strategies = [...system];

  if (includeScreenerCustom) {
    const userPresets = await prisma.screenerPreset.findMany({
      where: { userId, isSystem: false },
      take: 50,
      select: { id: true, name: true },
    });
    strategies.push(...userPresets.map(customScreenerPresetToStrategyDef));
  }

  if (includeSwingCustom) {
    const userSwingProfiles = await prisma.swingRuleProfile.findMany({
      where: { userId, isSystem: false },
      take: 50,
      select: { id: true, name: true },
    });
    strategies.push(
      ...userSwingProfiles.map((p) => ({
        key: `${USER_SWING_RULE_PROFILE_KEY_PREFIX}${p.id}`,
        label: p.name,
        description: 'Custom swing rule profile',
        style: 'swing' as const,
        engine: 'swing' as const,
        horizon: 'Custom',
        universe_default: USER_SWING_RULE_DEFAULT_UNIVERSE,
        max_scan_default: USER_SWING_RULE_DEFAULT_MAX_SCAN,
        icon: 'S',
        ready: true,
      })),
    );
  }

  return {
    style_labels: STRATEGY_STYLE_LABELS,
    ready_count: strategies.filter((s) => s.ready).length,
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
  if (userId && isUserScreenerPresetKey(input.strategy)) {
    const presetId = userScreenerPresetIdFromKey(input.strategy);
    const preset = await prisma.screenerPreset.findUnique({
      where: { id: presetId },
      select: { id: true, name: true, filters: true, userId: true },
    });

    if (!preset || preset.userId !== userId) throw new Error('Custom strategy not found');

    const universe = input.universe?.trim() || USER_SCREENER_DEFAULT_UNIVERSE;
    const maxScan =
      input.maxScan != null && input.maxScan > 0 ? input.maxScan : USER_SCREENER_DEFAULT_MAX_SCAN;
    const symbols = await resolveUniverseSymbols(universe, maxScan > 0 ? maxScan : 2000);
    const scanCount = symbols.length;

    const background = shouldStrategyRunInBackground('screener', scanCount, input.background);

    if (!background) {
      const run = await runLiveScreener(
        symbols,
        undefined,
        (preset.filters ?? {}) as ScreenerFilters,
        undefined,
        { refresh: Boolean(input.refresh) },
      );

      const result = {
        engine: 'screener' as const,
        strategy: input.strategy,
        label: preset.name,
        universe,
        scanned: run.scanned,
        passed: run.rows.length,
        rows: run.rows,
        restricted_skipped: run.restricted_skipped,
        cache_hits: run.cache_hits,
      };

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

    void executeStrategyJob(job.id, input, userId).catch(async (err) => {
      const message = err instanceof Error ? err.message : 'Strategy failed';
      await prisma.job.update({
        where: { id: job.id },
        data: { status: JobStatus.failed, error: message, finishedAt: new Date() },
      });
    });

    return { jobId: job.id, background: true as const, status: 'pending' as const };
  }

  if (userId && isUserSwingRuleProfileKey(input.strategy)) {
    const profileId = userSwingRuleProfileIdFromKey(input.strategy);
    const profile = await prisma.swingRuleProfile.findUnique({
      where: { id: profileId },
      select: { id: true, name: true, options: true, userId: true },
    });
    if (!profile || profile.userId !== userId) throw new Error('Custom swing rule profile not found');

    const universe = input.universe?.trim() || USER_SWING_RULE_DEFAULT_UNIVERSE;
    const maxScan =
      input.maxScan != null && input.maxScan > 0 ? input.maxScan : USER_SWING_RULE_DEFAULT_MAX_SCAN;
    const symbols = await resolveUniverseSymbols(universe, maxScan > 0 ? maxScan : 2000);
    const scanCount = symbols.length;

    const background = shouldStrategyRunInBackground('swing', scanCount, input.background);

    const swingOptions = (profile.options ?? {}) as SwingScanOptions;

    if (!background) {
      const run = await runSwingScan(symbols, swingOptions, Boolean(input.refresh));
      const result = {
        engine: 'swing' as const,
        strategy: input.strategy,
        label: profile.name,
        universe,
        scanned: scanCount,
        hits: run.hits as Array<Record<string, unknown>>,
        skipped: run.skipped ?? 0,
      };
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

    void executeStrategyJob(job.id, input, userId).catch(async (err) => {
      const message = err instanceof Error ? err.message : 'Strategy failed';
      await prisma.job.update({
        where: { id: job.id },
        data: { status: JobStatus.failed, error: message, finishedAt: new Date() },
      });
    });

    return { jobId: job.id, background: true as const, status: 'pending' as const };
  }

  const def = getStrategy(input.strategy);
  if (!def) throw new Error(`Unknown strategy: ${input.strategy}`);

  const universe = input.universe?.trim() || def.universe_default;
  const maxScan =
    input.maxScan != null && input.maxScan > 0 ? input.maxScan : def.max_scan_default || 200;
  const symbols = await resolveUniverseSymbols(universe, maxScan > 0 ? maxScan : 2000);
  const scanCount =
    input.maxScan != null && input.maxScan > 0 ? Math.min(input.maxScan, symbols.length) : symbols.length;

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

  void executeStrategyJob(job.id, input, userId).catch(async (err) => {
    const message = err instanceof Error ? err.message : 'Strategy failed';
    await prisma.job.update({
      where: { id: job.id },
      data: { status: JobStatus.failed, error: message, finishedAt: new Date() },
    });
  });

  return { jobId: job.id, background: true as const, status: 'pending' as const };
}

async function executeStrategyJob(jobId: string, input: StrategyRunInput, userId?: string) {
  if (userId && isUserScreenerPresetKey(input.strategy)) {
    const presetId = userScreenerPresetIdFromKey(input.strategy);
    const preset = await prisma.screenerPreset.findUnique({
      where: { id: presetId },
      select: { id: true, name: true, filters: true, userId: true },
    });
    if (!preset || preset.userId !== userId) throw new Error('Custom strategy not found');

    const universe = input.universe?.trim() || USER_SCREENER_DEFAULT_UNIVERSE;
    const maxScan =
      input.maxScan != null && input.maxScan > 0 ? input.maxScan : USER_SCREENER_DEFAULT_MAX_SCAN;
    const symbols = await resolveUniverseSymbols(universe, maxScan > 0 ? maxScan : 2000);

    await executeScreenerJob(
      jobId,
      symbols,
      undefined,
      (preset.filters ?? {}) as ScreenerFilters,
      { refresh: Boolean(input.refresh) },
    );
    return;
  }

  if (userId && isUserSwingRuleProfileKey(input.strategy)) {
    const profileId = userSwingRuleProfileIdFromKey(input.strategy);
    const profile = await prisma.swingRuleProfile.findUnique({
      where: { id: profileId },
      select: { id: true, name: true, options: true, userId: true },
    });
    if (!profile || profile.userId !== userId) throw new Error('Custom swing rule profile not found');

    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.running, startedAt: new Date() },
    });
    const universe = input.universe?.trim() || USER_SWING_RULE_DEFAULT_UNIVERSE;
    const maxScan =
      input.maxScan != null && input.maxScan > 0 ? input.maxScan : USER_SWING_RULE_DEFAULT_MAX_SCAN;
    const symbols = await resolveUniverseSymbols(universe, maxScan > 0 ? maxScan : 2000);

    await setJobProgress(jobId, {
      phase: 'scan',
      total: symbols.length,
      processed: 0,
      passed: 0,
    });

    const run = await runSwingScan(symbols, (profile.options ?? {}) as SwingScanOptions, Boolean(input.refresh));
    const result = {
      engine: 'swing' as const,
      strategy: input.strategy,
      label: profile.name,
      universe,
      scanned: symbols.length,
      hits: run.hits as Array<Record<string, unknown>>,
      skipped: run.skipped ?? 0,
    };

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.done,
        result: result as object,
        finishedAt: new Date(),
        progress: { phase: 'done', total: symbols.length, processed: symbols.length, passed: result.hits.length },
      },
    });

    await setJobProgress(jobId, {
      phase: 'done',
      total: symbols.length,
      processed: symbols.length,
      passed: result.hits.length,
    });

    return;
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date() },
  });

  await setJobProgress(jobId, { phase: 'pending', total: 1, processed: 0, passed: 0 });

  const result = await runStrategy(toRunnerInput(input), async (progress) => {
    await setJobProgress(jobId, {
      phase: progress.phase,
      total: progress.total,
      processed: progress.processed,
      passed: progress.passed,
      stage_label: progress.stage_label,
    });
    await prisma.job
      .update({
        where: { id: jobId },
        data: {
          progress: {
            phase: progress.phase,
            total: progress.total,
            processed: progress.processed,
            passed: progress.passed,
            stage_label: progress.stage_label,
          },
        },
      })
      .catch(() => undefined);
  });

  const passed =
    result.engine === 'screener'
      ? result.passed
      : result.engine === 'hybrid'
        ? result.hits.length
        : result.hits.length;

  const doneProgress = {
    phase: 'done' as const,
    total: result.scanned,
    processed: result.scanned,
    passed,
    stage_label:
      result.engine === 'hybrid'
        ? `Done · ${result.screener_passed} screened → ${result.hits.length} hits`
        : 'Done',
  };

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.done,
      result: result as object,
      finishedAt: new Date(),
      progress: doneProgress,
    },
  });

  await setJobProgress(jobId, doneProgress);

  return result;
}

export async function executeStrategy(input: StrategyRunInput) {
  return runStrategy(input);
}

export {
  listStrategyDailyProof,
  runStrategyDailyProofBatch,
} from '@sv/data-adapters';

