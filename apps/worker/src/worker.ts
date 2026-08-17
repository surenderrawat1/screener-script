import './load-env.js';

import { hostname } from 'node:os';
import { prisma, JobStatus } from '@sv/db';
import {
  executeScreenerJob,
  executeAutoScanPlan,
  verifyStock,
  runSwingScan,
  tickSwingAutoScan,
  tickDailySync,
  tickMorningPrewarm,
  tickIntradayPaperTrade,
  tickSwingPaperTrade,
  tickEveningGttSignals,
  tickStrategyDailyProof,
  tickOpenPositionExitAlerts,
  tickFundamentalAutoScan,
  tickConfigReload,
  bootstrapAppConfig,
  readConfigGeneration,
} from '@sv/data-adapters';
import {
  connectRedis,
  setJobProgress,
  setWorkerHeartbeat,
  tryHoldWorkerLeader,
  releaseWorkerLeader,
} from '@sv/cache';
import { createScreenerWorker, createSwingScanWorker, createVerifyBatchWorker } from '@sv/jobs';
import { getSchedules } from '@sv/shared';
import type { ScreenerFilters } from '@sv/core';

import type { VerifyBatchJobPayload } from '@sv/jobs';

const WORKER_ID = `${hostname()}-${process.pid}`;
const AUTO_SCAN_TICK_MS = 60_000;
const LEADER_REFRESH_MS = 20_000;
const SWING_SORT_KEYS = [
  'symbol',
  'swing_rank',
  'rules_passed',
  'r_multiple',
  'pct_52w',
  'volume_ratio',
  'entry_score',
  'rsi',
] as const;

type SwingSortKey = (typeof SWING_SORT_KEYS)[number];

let isScheduleLeader = true;

function swingSortKey(value?: string): SwingSortKey | undefined {
  return SWING_SORT_KEYS.includes(value as SwingSortKey) ? (value as SwingSortKey) : undefined;
}

async function refreshScheduleLeadership(): Promise<boolean> {
  isScheduleLeader = await tryHoldWorkerLeader(WORKER_ID);
  await setWorkerHeartbeat(WORKER_ID, { leader: isScheduleLeader });
  return isScheduleLeader;
}

function runIfLeader(label: string, fn: () => Promise<unknown>): void {
  if (!isScheduleLeader) return;
  void fn().catch((err) => {
    console.error(`${label} failed:`, err instanceof Error ? err.message : err);
  });
}

async function processScreenerJob(data: {
  jobId: string;
  input: {
    preset?: string;
    filters?: Record<string, unknown>;
    exclude_restricted?: boolean;
    refresh?: boolean;
    recommendation_filter?: string;
  };
  symbols: string[];
}) {
  const { jobId, input, symbols } = data;
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { createdBy: true } });
  const filters = (input.filters ?? {}) as ScreenerFilters;
  const options = {
    exclude_restricted: input.exclude_restricted !== false,
    refresh: Boolean(input.refresh),
    recommendation_filter: input.recommendation_filter,
    user_id: job?.createdBy ?? undefined,
  };
  await executeScreenerJob(jobId, symbols, input.preset, filters, options);
}

async function processSwingScanJob(data: {
  jobId: string;
  input: {
    min_verdict?: 'ENTER' | 'SETUP_PLUS' | 'WATCH' | 'ALL';
    zone_52w?: string;
    gc9_only?: boolean;
    breakout_volume?: boolean;
    min_rules_passed?: number;
    require_rules?: string[];
    sort_by?: string;
    refresh?: boolean;
    auto_radar?: boolean;
    scan_mode?: string;
    symbols?: string[];
    refresh_symbols?: string[];
    rotate_offset?: number;
    universe?: string;
    regime?: Record<string, unknown>;
  };
  symbols: string[];
}) {
  const { jobId, input, symbols } = data;

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date() },
  });

  let lastDbWrite = 0;
  const reportProgress = async (progress: {
    phase: string;
    total: number;
    processed: number;
    passed?: number;
  }) => {
    await setJobProgress(jobId, progress);
    const now = Date.now();
    const shouldPersist =
      progress.processed === 0 ||
      progress.processed >= progress.total ||
      now - lastDbWrite >= 2_000 ||
      progress.processed % 16 === 0;
    if (shouldPersist) {
      lastDbWrite = now;
      await prisma.job.update({
        where: { id: jobId },
        data: { progress: progress as object },
      });
    }
  };

  await reportProgress({
    phase: 'pending',
    total: (input.symbols ?? symbols).length,
    processed: 0,
    passed: 0,
  });

  const result = input.auto_radar
    ? await executeAutoScanPlan(
        {
          ...input,
          symbols: input.symbols ?? symbols,
        },
        Boolean(input.refresh),
        reportProgress,
      )
    : await runSwingScan(
        symbols,
        {
          min_verdict: input.min_verdict,
          zone_52w: input.zone_52w,
          gc9_only: input.gc9_only,
          breakout_volume: input.breakout_volume,
          min_rules_passed: input.min_rules_passed,
          require_rules: input.require_rules,
          sort_by: swingSortKey(input.sort_by),
          regime: input.regime,
          onProgress: reportProgress,
        },
        input.refresh,
      );

  const hits = Array.isArray((result as { hits?: unknown }).hits)
    ? (result as { hits: unknown[] }).hits
    : [];

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
        passed: hits.length,
      },
    },
  });

  await setJobProgress(jobId, {
    phase: 'done',
    total: symbols.length,
    processed: symbols.length,
    passed: hits.length,
  });
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '').split('.')[0] ?? '';
}

const DEFAULT_WATCHLIST_NAME = 'Main';

async function getOrCreateDefaultWatchlist(userId: string) {
  const existing = await prisma.watchlist.findFirst({
    where: { userId, name: DEFAULT_WATCHLIST_NAME },
    include: { items: { orderBy: { addedAt: 'desc' } } },
  });
  if (existing) return existing;

  return prisma.watchlist.create({
    data: { userId, name: DEFAULT_WATCHLIST_NAME },
    include: { items: { orderBy: { addedAt: 'desc' } } },
  });
}

async function syncWatchlistFromVerify(
  userId: string,
  symbol: string,
  snapshot: {
    stock_name?: string;
    sector?: string;
    last_score?: number;
    last_mos?: number | null;
    last_verdict?: string;
  },
) {
  const sym = normalizeSymbol(symbol);
  if (!sym) return;

  const watchlist = await getOrCreateDefaultWatchlist(userId);
  const existing = await prisma.watchlistItem.findUnique({
    where: { watchlistId_symbol: { watchlistId: watchlist.id, symbol: sym } },
  });
  const prevMeta = (existing?.meta ?? {}) as Record<string, unknown>;

  await prisma.watchlistItem.upsert({
    where: { watchlistId_symbol: { watchlistId: watchlist.id, symbol: sym } },
    create: {
      watchlistId: watchlist.id,
      symbol: sym,
      meta: {
        stock_name: snapshot.stock_name ?? sym,
        sector: snapshot.sector ?? '',
        last_verified_at: new Date().toISOString().slice(0, 10),
        last_score: snapshot.last_score ?? 0,
        last_mos: snapshot.last_mos ?? null,
        last_verdict: snapshot.last_verdict ?? '',
        verify_mode: 'quick',
        recommendation_basis: 'screening_matrix',
        score_basis: 'quality_proxy',
      } as any,
    },
    update: {
      meta: {
        ...prevMeta,
        stock_name: snapshot.stock_name ?? prevMeta.stock_name ?? sym,
        sector: snapshot.sector ?? prevMeta.sector ?? '',
        last_verified_at: new Date().toISOString().slice(0, 10),
        last_score: snapshot.last_score ?? prevMeta.last_score ?? 0,
        last_mos: snapshot.last_mos ?? prevMeta.last_mos ?? null,
        last_verdict: snapshot.last_verdict ?? prevMeta.last_verdict ?? '',
        verify_mode: 'quick',
        recommendation_basis: 'screening_matrix',
        score_basis: 'quality_proxy',
      } as any,
    },
  });
}

async function processVerifyBatchJob(data: VerifyBatchJobPayload) {
  const { jobId, symbols, input, userId } = data;
  const refresh = Boolean(input?.refresh);

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date() },
  });

  let lastDbWrite = 0;
  const reportProgress = async (progress: { phase: string; total: number; processed: number; passed?: number }) => {
    await setJobProgress(jobId, progress);
    const now = Date.now();
    const shouldPersist =
      progress.processed === 0 ||
      progress.processed >= progress.total ||
      now - lastDbWrite >= 2_000 ||
      progress.processed % 16 === 0;
    if (shouldPersist) {
      lastDbWrite = now;
      await prisma.job.update({
        where: { id: jobId },
        data: { progress: progress as object },
      });
    }
  };

  await reportProgress({ phase: 'pending', total: symbols.length, processed: 0, passed: 0 });

  const rows: unknown[] = [];
  let passed = 0;

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const out = await verifyStock(symbol, refresh);

    const metrics = out.metrics;
    const analysis = out.analysis;
    const memo = out.memo;
    const assumptions = out.assumptions;
    const sources = out.sources;
    const companyName = out.company_name;

    if (out.success) passed++;

    const row = {
      symbol: metrics.symbol,
      success: Boolean(out.success),
      company_name: companyName,
      metrics,
      analysis,
      memo,
      assumptions,
      screening_mode: out.screening_mode,
      sources,
      from_cache: out.from_cache,
      educational_only: true,
      disclaimer: 'Research tool only — not SEBI-registered investment advice.',
    };

    rows.push(row);

    await prisma.verificationRun.create({
      data: {
        userId,
        symbol: metrics.symbol,
        mode: 'auto',
        input: { refresh } as any,
        result: row as object,
      },
    }).catch(() => undefined);

    if (userId) {
      const a = analysis as {
        quality_score?: number;
        verify_score?: number;
        mos?: number | null;
        recommendation?: string;
      };
      await syncWatchlistFromVerify(userId, metrics.symbol, {
        stock_name: String(companyName ?? metrics.name ?? metrics.symbol),
        sector: String(metrics.sector ?? ''),
        last_score: a.verify_score ?? Math.round(((a.quality_score ?? 0) * 56) / 100),
        last_mos: a.mos ?? null,
        last_verdict: a.recommendation ?? '',
      }).catch(() => undefined);
    }

    if (i === 0 || (i + 1) % 8 === 0 || i + 1 === symbols.length) {
      await reportProgress({ phase: 'verify', total: symbols.length, processed: i + 1, passed });
    }
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.done,
      result: { rows, passed } as object,
      finishedAt: new Date(),
      progress: {
        phase: 'done',
        total: symbols.length,
        processed: symbols.length,
        passed,
      },
    },
  });

  await setJobProgress(jobId, {
    phase: 'done',
    total: symbols.length,
    processed: symbols.length,
    passed,
  });
}

async function main() {
  await connectRedis().catch(() => undefined);
  await bootstrapAppConfig().catch(async () => {
    const { initAppConfig } = await import('@sv/shared');
    await initAppConfig();
  });
  const schedules = getSchedules();
  const configGeneration = { current: 0 };
  try {
    configGeneration.current = await readConfigGeneration();
  } catch {
    configGeneration.current = 0;
  }

  setInterval(() => {
    void tickConfigReload(configGeneration)
      .then((reloaded) => {
        if (reloaded) console.log('Worker config reloaded from YAML / app_settings');
      })
      .catch(() => undefined);
  }, AUTO_SCAN_TICK_MS);

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

  const verifyBatchWorker = createVerifyBatchWorker(async (job) => {
    try {
      await processVerifyBatchJob(job.data);
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
  verifyBatchWorker.on('failed', (job, err) => console.error(`Verify batch job ${job?.id} failed:`, err.message));

  await refreshScheduleLeadership();
  setInterval(() => {
    void refreshScheduleLeadership().catch((err) => {
      console.error('Leader refresh failed:', err instanceof Error ? err.message : err);
    });
  }, LEADER_REFRESH_MS);

  setInterval(() => {
    runIfLeader('Swing auto-scan tick', () => tickSwingAutoScan());
  }, AUTO_SCAN_TICK_MS);

  const ltgAuto = schedules.intraday.ltg_auto_scan;
  if (ltgAuto?.enabled !== false) {
    setInterval(() => {
      runIfLeader('LTG auto-scan tick', () =>
        tickFundamentalAutoScan().then((result) => {
          if (result) {
            console.log(
              `LTG auto scan — ${result.scanned} scanned, ${result.buy_eligible} buy-eligible (${result.duration_ms}ms)`,
            );
          }
        }),
      );
    }, AUTO_SCAN_TICK_MS);
  }


  setInterval(() => {
    runIfLeader('Daily sync tick', () =>
      tickDailySync().then((result) => {
        if (result) {
          console.log(`Daily sync completed — job ${result.job_id} (${result.ok ? 'ok' : 'failed'})`);
        }
      }),
    );
  }, AUTO_SCAN_TICK_MS);

  setInterval(() => {
    runIfLeader('Morning pre-warm tick', () =>
      tickMorningPrewarm().then((result) => {
        if (result) {
          console.log(
            `Morning pre-warm completed — regime ${result.regime_key ?? '—'}, ETF hits ${result.etf_hit_count}`,
          );
        }
      }),
    );
  }, AUTO_SCAN_TICK_MS);

  setInterval(() => {
    runIfLeader('Evening GTT tick', () =>
      tickEveningGttSignals().then((result) => {
        if (result) {
          console.log(`Evening GTT digest — ${result.order_count} order(s) for ${result.date_key}`);
        }
      }),
    );
  }, AUTO_SCAN_TICK_MS);

  setInterval(() => {
    runIfLeader('Strategy daily proof tick', () =>
      tickStrategyDailyProof().then((result) => {
        if (result && !result.skipped_weekend) {
          console.log(
            `Strategy daily proof — ${result.ran} run(s), ${result.failed} failed (${result.date_key})`,
          );
        }
      }),
    );
  }, AUTO_SCAN_TICK_MS);

  setInterval(() => {
    runIfLeader('Open exit alerts tick', () =>
      tickOpenPositionExitAlerts().then((result) => {
        if (result && !result.skipped_weekend) {
          console.log(
            `Open exit alerts — swing ${result.swing_exits}, intraday ${result.intraday_exits}, emails ${result.emails_sent}`,
          );
        }
      }),
    );
  }, AUTO_SCAN_TICK_MS);

  const intradayPaper = schedules.intraday.paper_auto_trade;
  if (intradayPaper?.enabled !== false) {
    setInterval(() => {
      runIfLeader('Intraday paper tick', () =>
        tickIntradayPaperTrade().then((result) => {
          if (result.wallets > 0) {
            console.log(`Paper trader tick — ${result.wallets} armed wallet(s)`);
          }
        }),
      );
    }, Math.max(15, intradayPaper?.interval_sec ?? 60) * 1000);
  }

  const swingPaper = schedules.intraday.swing_paper_auto_trade;
  if (swingPaper?.enabled !== false) {
    setInterval(() => {
      runIfLeader('Swing paper tick', () =>
        tickSwingPaperTrade().then((result) => {
          if (result.wallets > 0) {
            console.log(`Swing paper trader tick — ${result.wallets} armed wallet(s)`);
          }
        }),
      );
    }, Math.max(15, swingPaper?.interval_sec ?? 60) * 1000);
  }

  const shutdown = () => {
    void releaseWorkerLeader(WORKER_ID).finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  console.log(
    `Worker ${WORKER_ID} started — queues: sv-screener, sv-swing-scan (auto tick ${AUTO_SCAN_TICK_MS / 1000}s, schedule leader=${isScheduleLeader})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
