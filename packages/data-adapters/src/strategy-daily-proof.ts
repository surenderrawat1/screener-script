/**
 * Daily live strategy proof — scheduled catalog runs for hit tracking & improvement analysis.
 * Does not place paper/broker orders; persists comparable daily scorecards.
 */
import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { prisma } from '@sv/db';
import {
  CACHE_PREFIX,
  dateKeyInTimezone,
  getConfigTimezone,
  getSchedules,
  isDailyCronDue,
  nseSession,
} from '@sv/shared';
import { getStrategy, listStrategies } from '@sv/swing';
import { runStrategy, type StrategyRunResult } from './strategy-runner.js';

const PROOF_META_KEY = 'strategy-daily-proof:last';

export interface StrategyDailyHitSummary {
  symbol: string;
  score?: number | null;
  verdict?: string | null;
  price?: number | null;
}

export interface StrategyDailyProofBatchResult {
  date_key: string;
  started_at: string;
  finished_at: string;
  ok: boolean;
  ran: number;
  failed: number;
  skipped_weekend?: boolean;
  results: Array<{
    strategy_key: string;
    label: string;
    status: string;
    hit_count: number;
    scanned: number;
    duration_ms: number;
    error?: string;
  }>;
}

function topHitsFromResult(result: StrategyRunResult, limit = 12): StrategyDailyHitSummary[] {
  if (result.engine === 'screener') {
    return result.rows.slice(0, limit).map((row) => ({
      symbol: String(row.symbol ?? '').toUpperCase(),
      score: typeof row.composite_score === 'number' ? row.composite_score : null,
      verdict: String(row.recommendation ?? '') || null,
      price: typeof row.price === 'number' ? row.price : null,
    }));
  }

  const hits = result.hits ?? [];
  return hits.slice(0, limit).map((hit) => ({
    symbol: String(hit.symbol ?? '')
      .trim()
      .toUpperCase(),
    score:
      typeof hit.decision_score === 'number'
        ? hit.decision_score
        : typeof hit.swing_rank === 'number'
          ? hit.swing_rank
          : typeof hit.entry_score === 'number'
            ? hit.entry_score
            : null,
    verdict: String(hit.strict_verdict ?? hit.verdict ?? hit.decision_label ?? '') || null,
    price: typeof hit.price === 'number' ? hit.price : null,
  }));
}

function hitCount(result: StrategyRunResult): number {
  if (result.engine === 'screener') return result.passed;
  return result.hits?.length ?? 0;
}

function scannedCount(result: StrategyRunResult): number {
  if (result.engine === 'hybrid') return result.scanned;
  return result.scanned;
}

function resolveStrategyKeys(configured?: string[]): string[] {
  if (configured?.length) return configured;
  // Default allowlist — fast enough for a post-close batch on Tier-A / small universes.
  return [
    'swing_strict_enter',
    'swing_ma20_stratzy',
    'swing_breakout_volume',
    'swing_best_r',
    'hybrid_quality_swing',
  ];
}

export async function hasStrategyDailyProofToday(timezone = getConfigTimezone()): Promise<boolean> {
  const dateKey = dateKeyInTimezone(timezone);
  const meta = await cacheGetJson<{ date_key?: string; status?: string }>(
    cacheKey(CACHE_PREFIX.MORNING, PROOF_META_KEY),
  );
  if (meta?.date_key === dateKey && meta.status === 'done') return true;

  const row = await prisma.strategyDailyRun.findFirst({
    where: {
      runDate: dateKey,
      status: { in: ['ok', 'done'] },
    },
    select: { id: true },
  });
  return row != null;
}

async function markProofMeta(dateKey: string, status: 'running' | 'done', extra?: Record<string, unknown>) {
  await cacheSetJson(
    cacheKey(CACHE_PREFIX.MORNING, PROOF_META_KEY),
    { date_key: dateKey, status, updated_at: new Date().toISOString(), ...extra },
    2 * 86400,
  );
}

export async function runStrategyDailyProofBatch(
  options: { force?: boolean; strategies?: string[]; maxScan?: number } = {},
): Promise<StrategyDailyProofBatchResult> {
  const schedules = getSchedules();
  const cfg = schedules.intraday.strategy_daily_proof;
  const tz = cfg?.timezone ?? getConfigTimezone();
  const dateKey = dateKeyInTimezone(tz);
  const startedAt = new Date().toISOString();
  const session = nseSession();

  if (cfg?.skip_weekends !== false && session.phase === 'weekend' && !options.force) {
    return {
      date_key: dateKey,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok: true,
      ran: 0,
      failed: 0,
      skipped_weekend: true,
      results: [],
    };
  }

  if (!options.force && (await hasStrategyDailyProofToday(tz))) {
    const existing = await listStrategyDailyProof({ days: 1 });
    return {
      date_key: dateKey,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok: true,
      ran: existing.runs.length,
      failed: existing.runs.filter((r) => r.status === 'failed').length,
      results: existing.runs.map((r) => ({
        strategy_key: r.strategy_key,
        label: r.label,
        status: r.status,
        hit_count: r.hit_count,
        scanned: r.scanned,
        duration_ms: r.duration_ms,
        error: r.error ?? undefined,
      })),
    };
  }

  await markProofMeta(dateKey, 'running');

  const keys = resolveStrategyKeys(options.strategies ?? cfg?.strategies);
  const maxScan = options.maxScan ?? cfg?.max_scan ?? 60;
  const batchResults: StrategyDailyProofBatchResult['results'] = [];
  let failed = 0;

  for (const key of keys) {
    const def = getStrategy(key);
    const label = def?.label ?? key;
    const t0 = Date.now();

    if (!def?.ready) {
      const duration = Date.now() - t0;
      await prisma.strategyDailyRun.upsert({
        where: { runDate_strategyKey: { runDate: dateKey, strategyKey: key } },
        create: {
          runDate: dateKey,
          strategyKey: key,
          label,
          engine: def?.engine ?? 'unknown',
          universe: def?.universe_default ?? '',
          status: 'skipped',
          scanned: 0,
          hitCount: 0,
          topSymbols: [],
          summary: { reason: def?.blocked_reason ?? 'not ready' },
          durationMs: duration,
          error: def?.blocked_reason ?? 'Strategy not ready',
        },
        update: {
          label,
          status: 'skipped',
          durationMs: duration,
          error: def?.blocked_reason ?? 'Strategy not ready',
          summary: { reason: def?.blocked_reason ?? 'not ready' },
        },
      });
      batchResults.push({
        strategy_key: key,
        label,
        status: 'skipped',
        hit_count: 0,
        scanned: 0,
        duration_ms: duration,
        error: def?.blocked_reason ?? 'not ready',
      });
      continue;
    }

    try {
      const result = await runStrategy({ strategy: key, maxScan, refresh: false });
      const tops = topHitsFromResult(result);
      const hits = hitCount(result);
      const scanned = scannedCount(result);
      const duration = Date.now() - t0;
      const summary = {
        engine: result.engine,
        universe: result.universe,
        label: result.label,
        top_hits: tops,
        screener_passed: result.engine === 'hybrid' ? result.screener_passed : undefined,
      };

      await prisma.strategyDailyRun.upsert({
        where: { runDate_strategyKey: { runDate: dateKey, strategyKey: key } },
        create: {
          runDate: dateKey,
          strategyKey: key,
          label: result.label,
          engine: result.engine,
          universe: result.universe,
          status: 'ok',
          scanned,
          hitCount: hits,
          topSymbols: tops.map((t) => t.symbol).filter(Boolean),
          summary: summary as object,
          durationMs: duration,
          error: null,
        },
        update: {
          label: result.label,
          engine: result.engine,
          universe: result.universe,
          status: 'ok',
          scanned,
          hitCount: hits,
          topSymbols: tops.map((t) => t.symbol).filter(Boolean),
          summary: summary as object,
          durationMs: duration,
          error: null,
        },
      });

      batchResults.push({
        strategy_key: key,
        label: result.label,
        status: 'ok',
        hit_count: hits,
        scanned,
        duration_ms: duration,
      });
    } catch (err) {
      failed += 1;
      const duration = Date.now() - t0;
      const message = err instanceof Error ? err.message : 'Strategy daily proof failed';
      await prisma.strategyDailyRun.upsert({
        where: { runDate_strategyKey: { runDate: dateKey, strategyKey: key } },
        create: {
          runDate: dateKey,
          strategyKey: key,
          label,
          engine: def.engine,
          universe: def.universe_default,
          status: 'failed',
          scanned: 0,
          hitCount: 0,
          topSymbols: [],
          summary: {},
          durationMs: duration,
          error: message,
        },
        update: {
          status: 'failed',
          durationMs: duration,
          error: message,
        },
      });
      batchResults.push({
        strategy_key: key,
        label,
        status: 'failed',
        hit_count: 0,
        scanned: 0,
        duration_ms: duration,
        error: message,
      });
    }
  }

  const finished: StrategyDailyProofBatchResult = {
    date_key: dateKey,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    ok: failed === 0,
    ran: batchResults.length,
    failed,
    results: batchResults,
  };

  await markProofMeta(dateKey, 'done', { ran: finished.ran, failed });
  return finished;
}

export async function tickStrategyDailyProof(now = new Date()): Promise<StrategyDailyProofBatchResult | null> {
  const schedules = getSchedules();
  const cfg = schedules.intraday.strategy_daily_proof;
  if (!cfg?.enabled) return null;

  const tz = cfg.timezone || getConfigTimezone();
  if (await hasStrategyDailyProofToday(tz)) return null;
  if (!isDailyCronDue(cfg.cron, tz, now)) return null;

  return runStrategyDailyProofBatch();
}

export async function listStrategyDailyProof(options: { days?: number; strategy?: string } = {}) {
  const days = options.days && options.days > 0 ? Math.min(options.days, 90) : 14;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceKey = since.toISOString().slice(0, 10);

  const rows = await prisma.strategyDailyRun.findMany({
    where: {
      runDate: { gte: sinceKey },
      ...(options.strategy ? { strategyKey: options.strategy } : {}),
    },
    orderBy: [{ runDate: 'desc' }, { hitCount: 'desc' }],
    take: 500,
  });

  const catalog = listStrategies();
  const ready = catalog.filter((s) => s.ready).length;

  return {
    days,
    ready_strategies: ready,
    runs: rows.map((r) => ({
      id: r.id,
      run_date: r.runDate,
      strategy_key: r.strategyKey,
      label: r.label,
      engine: r.engine,
      universe: r.universe,
      status: r.status,
      scanned: r.scanned,
      hit_count: r.hitCount,
      top_symbols: r.topSymbols,
      summary: r.summary,
      duration_ms: r.durationMs,
      error: r.error,
      created_at: r.createdAt.toISOString(),
    })),
    scoreboard: buildScoreboard(rows),
  };
}

function buildScoreboard(
  rows: Array<{
    strategyKey: string;
    label: string;
    status: string;
    hitCount: number;
    runDate: string;
  }>,
) {
  const byKey = new Map<
    string,
    { strategy_key: string; label: string; days: number; ok_days: number; avg_hits: number; last_hits: number; last_date: string }
  >();

  for (const row of rows) {
    const cur = byKey.get(row.strategyKey) ?? {
      strategy_key: row.strategyKey,
      label: row.label,
      days: 0,
      ok_days: 0,
      avg_hits: 0,
      last_hits: row.hitCount,
      last_date: row.runDate,
    };
    cur.days += 1;
    if (row.status === 'ok') cur.ok_days += 1;
    cur.avg_hits += row.hitCount;
    if (row.runDate > cur.last_date) {
      cur.last_date = row.runDate;
      cur.last_hits = row.hitCount;
    }
    byKey.set(row.strategyKey, cur);
  }

  return [...byKey.values()]
    .map((row) => ({
      ...row,
      avg_hits: row.days > 0 ? Math.round((row.avg_hits / row.days) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.avg_hits - a.avg_hits);
}
