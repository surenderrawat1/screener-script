import './load-env.js';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@sv/db';
import {
  connectRedis,
  pingRedis,
  rateLimitCheck,
  cacheStats,
  cacheListKeys,
  cachePreviewKey,
  cacheClearPrefix,
  getJobProgress,
  getRedis,
  hasActiveWorker,
  redisHostLabel,
} from '@sv/cache';
import { getScreenerQueue, getSwingScanQueue, getVerifyBatchQueue, QUEUE_NAMES } from '@sv/jobs';
import {
  loginSchema,
  screenerRunSchema,
  verifyAutoSchema,
  verifyBatchSchema,
  verifyFullFetchSchema,
  verifyFullRunSchema,
  verifyFullDraftSchema,
  cfaTermUpsertSchema,
  createUniverseSchema,
  watchlistUpsertSchema,
  swingPositionCreateSchema,
  swingPositionCloseSchema,
  swingPositionUpdateSchema,
  niftyIntradayPositionCreateSchema,
  niftyIntradayPositionCloseSchema,
  niftyIntradayPositionUpdateSchema,
  paperWalletArmSchema,
  swingPaperArchiveSchema,
  paperPositionCloseSchema,
  swingScanSchema,
  swingAutoScanSchema,
  swingEvaluateSchema,
  swingEvaluateExitSchema,
  swingBacktestSchema,
  strategyRunSchema,
  userScreenerPresetCreateSchema,
  userScreenerPresetUpdateSchema,
  swingRuleProfileCreateSchema,
  swingRuleProfileUpdateSchema,
  screenerPitBacktestSchema,
  intradayBacktestSchema,
  PERMISSIONS,
  CACHE_PREFIX,
  initAppConfig,
  type ScreenerRow,
} from '@sv/shared';
import { toPitchCsv } from '@sv/core';
import { getScreenerHealthSummary } from '@sv/data-adapters';
import { requirePermission } from './lib/auth.js';
import { listUniverses, createCustomUniverse } from './services/universe.js';
import { createScreenerJob, getJob } from './services/screener.js';
import { listScreenerPresets, listUserScreenerPresets } from './services/screener-presets.js';
import { createStrategyRun, getJob as getStrategyJob, getTradingStrategy, listTradingStrategies, listStrategyDailyProof, runStrategyDailyProofBatch } from './services/strategies.js';
import { exchangeListSummary, runScreenerPitBacktest } from '@sv/data-adapters';
import { createSwingScanJob } from './services/swing.js';
import { runSwingBacktestJob } from './services/swing-backtest.js';
import { verifySymbol } from './services/verify.js';
import { createVerifyBatchJob, getJob as getVerifyBatchJob } from './services/verify-batch.js';
import { getVerifyFullPrefill, fetchVerifyFull, runVerifyFull, getVerifyFullDraft, saveVerifyFullDraft } from './services/verify-full.js';
import { getAdminStats, importEtfCsv, importIndexCsv, importNseEquityCsv, importPromoterHoldingCsv, importPromoterPledgeCsv, getIndexStatus, syncIndicesFromDisk } from './services/admin.js';
import {
  cfaTermCategories,
  deleteCfaTerm,
  getCfaTerm,
  listCfaTerms,
  reseedCfaTerms,
  upsertCfaTerm,
} from './services/cfa-docs.js';
import { bootstrapAppConfig, getEffectiveSettings, patchAppSettings, reloadConfigAndNotifyWorkers } from './services/settings.js';
import { fetchDailySyncStatus, runDailySyncJob } from './services/daily-sync.js';
import { runChartPatternScanJob } from './services/chart-patterns.js';
import { getStockSummary, getStockChart, getStockProfile, refreshStockCaches } from './services/stock-details.js';
import { getMorningBriefing, notifyMorningAlertsIfNeeded } from './services/morning.js';
import { getSignalsInbox } from './services/signals.js';
import {
  buildAndPersistEveningGttDigest,
  getEveningGttDigest,
  getResearchRiskPolicy,
  getSmtpStatus,
  getWhatsAppStatus,
  runOpenPositionExitAlerts,
  dispatchChartPatternAlerts,
  sendTestSignalEmail,
  sendWhatsAppTestMessage,
  getLatestChartPatternSnapshot,
  queryChartPatternFeed,
  listChartPatternScanRuns,
  listChartPatternScanDates,
  getChartPatternBacktestSummary,
} from '@sv/data-adapters';
import { getFundamentalAutoState, startFundamentalAutoScan } from './services/fundamental-auto.js';
import { getTradingPresetById, listTradingPresets } from './services/trading-presets.js';
import { getEconomicGates } from './services/economic-gates.js';
import { evaluateSwingSymbol, evaluateSwingExit } from '@sv/data-adapters';
import {
  listWatchlist,
  upsertWatchlistItem,
  removeWatchlistItem,
} from './services/watchlist.js';
import { listVerificationHistory, getVerificationRun } from './services/verification-history.js';
import {
  listSwingPositions,
  listSwingPositionsLive,
  exportSwingPositionsCsv,
  createSwingPosition,
  closeSwingPosition,
  reopenSwingPosition,
  updateSwingPosition,
  deleteSwingPosition,
} from './services/swing-positions.js';
import { getSwingChart } from './services/swing-chart.js';
import {
  getSwingAutoState,
  getSwingAutoPositions,
  getSwingAutoProfile,
  getSwingPortfolioNav,
  setSwingPortfolioNav,
  validateSwingAddPosition,
  startSwingAutoScan,
} from './services/swing-auto.js';
import { getNiftyIntradayState, getNiftyIntradayLite, getIntradayInstruments, getIntradayChart, intradayIncludeFlag } from './services/intraday.js';
import { runIntradayBacktestJob } from './services/intraday-backtest.js';
import {
  listIntradayPositions,
  createIntradayPosition,
  updateIntradayPosition,
  closeIntradayPosition,
  reopenIntradayPosition,
  exportIntradayPositionsCsv,
} from './services/intraday-positions.js';
import {
  ensurePaperWallet,
  getPaperWalletState,
  setPaperAutoArmed,
  closePaperPosition,
  tickPaperUser,
  repairIntradayClosedBooks,
} from './services/intraday-paper.js';
import {
  archiveSwingPaperPeriod,
  getSwingPaperState,
  setSwingPaperAutoArmed,
  tickSwingPaperUser,
} from './services/swing-paper.js';
import { collectOpsAlerts } from './services/ops-alerts.js';

const PORT = parseInt(process.env.API_PORT ?? '3100', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

const ADMIN_CACHE_SCOPES = [
  {
    prefix: CACHE_PREFIX.STOCK,
    label: 'Stock fundamentals',
    ttl: '7 days',
    policy: 'Derived market/fundamental summary. Clear for stale Stock Details, Verify, or screener valuation inputs.',
    clearable: true,
  },
  {
    prefix: CACHE_PREFIX.VERIFY,
    label: 'CFA Verify results',
    ttl: '7 days',
    policy: 'Derived verification output. Clear after valuation-engine or data-quality rule changes.',
    clearable: true,
  },
  {
    prefix: CACHE_PREFIX.YAHOO,
    label: 'Yahoo raw/quotes',
    ttl: '7 days',
    policy: 'External market-data cache. Clear when prices or quote-summary data look stale.',
    clearable: true,
  },
  {
    prefix: CACHE_PREFIX.SCREENER_TABLE,
    label: 'Screener.in tables/profile',
    ttl: '24 hours',
    policy: 'External fundamentals/profile cache. Clear when annual financials or expenditure rows look stale.',
    clearable: true,
  },
  {
    prefix: CACHE_PREFIX.SCREENER_ROW,
    label: 'Screener rows',
    ttl: '1 hour',
    policy: 'Derived per-symbol screener rows. Clear after filter, ranking, or scoring changes.',
    clearable: true,
  },
  {
    prefix: CACHE_PREFIX.TA,
    label: 'Technical analysis/charts',
    ttl: '24 hours',
    policy: 'Derived chart/TA cache. Clear when daily bars, chart overlays, or entry rules changed.',
    clearable: true,
  },
  {
    prefix: CACHE_PREFIX.INTRADAY,
    label: 'Intraday radar snapshot',
    ttl: '60 seconds',
    policy: 'Playbook/state snapshot per instrument + TF. Refresh=?1 rebuilds live analysis; 60d accuracy gate stays cached.',
    clearable: true,
  },
  {
    prefix: CACHE_PREFIX.REGIME,
    label: 'Market regime',
    ttl: '15 minutes',
    policy: 'Derived NIFTYBEES regime. Clear if the regime appears stale intraday.',
    clearable: true,
  },
  {
    prefix: CACHE_PREFIX.MORNING,
    label: 'Morning briefing',
    ttl: '1-10 minutes',
    policy: 'Derived morning cockpit bundle/panels. Safe to clear after Morning UI or source changes.',
    clearable: true,
  },
  {
    prefix: CACHE_PREFIX.SWING_AUTO,
    label: 'Swing Auto snapshot',
    ttl: '2 hours',
    policy: 'Latest radar snapshot. Clear only if visibly stale; PostgreSQL archive remains durable.',
    clearable: true,
  },
  {
    prefix: CACHE_PREFIX.UNIVERSE,
    label: 'Universe symbols',
    ttl: '24 hours',
    policy: 'Redis mirror of PostgreSQL/index CSV data. Prefer daily/index sync before manual clear.',
    clearable: true,
  },
  {
    prefix: CACHE_PREFIX.INDEX,
    label: 'Index metadata',
    ttl: '30 days',
    policy: 'Redis mirror of index sync metadata. Prefer index sync; clearing may temporarily slow universe resolution.',
    clearable: true,
  },
  {
    prefix: CACHE_PREFIX.RATELIMIT,
    label: 'Rate limits',
    ttl: 'varies',
    policy: 'Operational guardrail. Not clearable from Admin UI.',
    clearable: false,
  },
  {
    prefix: CACHE_PREFIX.JOB_PROGRESS,
    label: 'Job progress',
    ttl: '1 hour',
    policy: 'Operational progress channel for running jobs. Not clearable from Admin UI.',
    clearable: false,
  },
  {
    prefix: CACHE_PREFIX.WORKER_HEARTBEAT,
    label: 'Worker heartbeat',
    ttl: 'short',
    policy: 'Operational liveness signal. Not clearable from Admin UI.',
    clearable: false,
  },
] as const;

function adminCacheScope(prefix: string) {
  return ADMIN_CACHE_SCOPES.find((scope) => scope.prefix === prefix.trim());
}

function validateAdminCachePrefix(prefix?: string) {
  const normalized = String(prefix ?? '').trim();
  if (!normalized || normalized.includes('*') || normalized.includes('?')) {
    return { error: 'Select a known cache scope. Wildcards are not allowed.' };
  }
  const scope = adminCacheScope(normalized);
  if (!scope) return { error: 'Unknown cache scope. Use one of the approved Admin cache scopes.' };
  return { prefix: normalized, scope };
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  await app.register(cors, {
    origin: CORS_ORIGIN,
    credentials: true,
  });

  await app.register(jwt, {
    secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-in-production',
  });

  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 } });

  await app.register(websocket);

  const authPreHandler = async (request: { jwtVerify: () => Promise<void> }) => {
    await request.jwtVerify();
  };

  const refreshTokenSchema = z.object({
    refreshToken: z.string().min(16),
  });

  // M13: Production guardrails
  const RATE_LIMIT_WINDOW_SECONDS = Number(process.env.SV_RATE_LIMIT_WINDOW_SECONDS ?? 60);
  const RATE_LIMIT_MAX_PER_WINDOW = Number(process.env.SV_RATE_LIMIT_MAX_PER_WINDOW ?? 30);

  const rateLimitPreHandler = (bucketSuffix: string, limit = RATE_LIMIT_MAX_PER_WINDOW) => {
    return async (request: any, reply: any) => {
      const userSub = request?.user?.sub ?? 'anon';
      const bucket = `${userSub}:${bucketSuffix}`;
      const { allowed, remaining } = await rateLimitCheck(bucket, limit, RATE_LIMIT_WINDOW_SECONDS);
      if (!allowed) {
        return reply
          .header('Retry-After', String(RATE_LIMIT_WINDOW_SECONDS))
          .status(429)
          .send({ error: 'Rate limit exceeded', remaining });
      }
    };
  };

  app.setErrorHandler((error, _request, reply) => {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode ?? 500;
    const message =
      process.env.SV_ENV === 'production' && statusCode === 500
        ? 'Internal server error'
        : err.message;
    reply.status(statusCode).send({ error: message });
  });

  app.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  app.get('/health/ready', async (request, reply) => {
    const adminKey = process.env.SV_ADMIN_KEY;
    if (adminKey && request.headers['x-admin-key'] !== adminKey) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    let pgOk = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      pgOk = true;
    } catch {
      pgOk = false;
    }

    const redisOk = await pingRedis();
    const workerOk = await hasActiveWorker();
    let pgHost = 'unknown';
    try {
      pgHost = new URL(process.env.DATABASE_URL ?? '').hostname || pgHost;
    } catch {
      pgHost = 'unknown';
    }

    const ok = pgOk && redisOk;
    return reply.status(ok ? 200 : 503).send({
      status: ok ? 'ready' : 'degraded',
      checks: {
        postgres: { ok: pgOk, host: pgHost },
        redis: { ok: redisOk, host: redisHostLabel() },
        worker: { ok: workerOk, detail: workerOk ? 'heartbeat seen' : 'no worker heartbeat' },
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Prometheus scraping endpoint (M13)
  app.get('/metrics', async (_request, reply) => {
    const lines: string[] = [];
    const nowMs = Date.now();

    // Queue depth: BullMQ waiting jobs
    try {
      const [screenerWaiting, swingWaiting, verifyBatchWaiting] = await Promise.all([
        getScreenerQueue().getWaitingCount(),
        getSwingScanQueue().getWaitingCount(),
        getVerifyBatchQueue().getWaitingCount(),
      ]);

      lines.push('# HELP sv_job_queue_waiting_total BullMQ waiting jobs');
      lines.push('# TYPE sv_job_queue_waiting_total gauge');
      lines.push(`sv_job_queue_waiting_total{queue="${QUEUE_NAMES.SCREENER}"} ${screenerWaiting}`);
      lines.push(`sv_job_queue_waiting_total{queue="${QUEUE_NAMES.SWING_SCAN}"} ${swingWaiting}`);
      lines.push(`sv_job_queue_waiting_total{queue="${QUEUE_NAMES.VERIFY_BATCH}"} ${verifyBatchWaiting}`);
      lines.push(
        `sv_job_queue_waiting_total ${screenerWaiting + swingWaiting + verifyBatchWaiting}`,
      );
    } catch {
      lines.push('# HELP sv_job_queue_waiting_total BullMQ waiting jobs');
      lines.push('# TYPE sv_job_queue_waiting_total gauge');
      lines.push(`sv_job_queue_waiting_total{queue="${QUEUE_NAMES.SCREENER}"} 0`);
      lines.push(`sv_job_queue_waiting_total{queue="${QUEUE_NAMES.SWING_SCAN}"} 0`);
      lines.push(`sv_job_queue_waiting_total{queue="${QUEUE_NAMES.VERIFY_BATCH}"} 0`);
      lines.push('sv_job_queue_waiting_total 0');
    }

    // Worker heartbeat age: max age across workers (from Redis cache JSON)
    try {
      const redis = getRedis();
      let cursor = '0';
      let maxAgeSeconds = 0;
      let any = false;

      do {
        const [next, keys] = await redis.scan(
          cursor,
          'MATCH',
          `${CACHE_PREFIX.WORKER_HEARTBEAT}:*`,
          'COUNT',
          100,
        );
        cursor = next;
        if (keys.length === 0) continue;

        const raw = await Promise.all(keys.map((k) => redis.get(k)));
        for (const r of raw) {
          if (!r) continue;
          any = true;
          try {
            const parsed = JSON.parse(r) as { at?: string };
            const at = parsed?.at ? Date.parse(parsed.at) : NaN;
            if (Number.isFinite(at)) {
              const ageSeconds = (nowMs - at) / 1000;
              if (ageSeconds > maxAgeSeconds) maxAgeSeconds = ageSeconds;
            }
          } catch {
            // Ignore malformed heartbeat JSON.
          }
        }
      } while (cursor !== '0');

      lines.push('# HELP sv_worker_heartbeat_age_seconds Worker heartbeat age (max across workers)');
      lines.push('# TYPE sv_worker_heartbeat_age_seconds gauge');
      lines.push(`sv_worker_heartbeat_age_seconds ${any ? maxAgeSeconds : 0}`);
    } catch {
      lines.push('# HELP sv_worker_heartbeat_age_seconds Worker heartbeat age (max across workers)');
      lines.push('# TYPE sv_worker_heartbeat_age_seconds gauge');
      lines.push('sv_worker_heartbeat_age_seconds 0');
    }

    reply.type('text/plain').send(lines.join('\n'));
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Refresh token (M13: rotation using sessions table)
    const refreshTokenTtlDays = Number(process.env.SV_REFRESH_TOKEN_TTL_DAYS ?? 30);
    const refreshTokenExpiresAt = new Date(Date.now() + refreshTokenTtlDays * 86400000);
    const refreshToken = randomBytes(32).toString('hex');
    const refreshTokenHash = createHash('sha256').update(refreshToken).digest('hex');

    await prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash,
        expiresAt: refreshTokenExpiresAt,
        ip: (request as any).ip ? String((request as any).ip) : undefined,
        userAgent: request.headers['user-agent'] ? String(request.headers['user-agent']) : undefined,
      },
    }).catch(() => undefined);

    const token = await reply.jwtSign(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: '15m' },
    );

    return {
      accessToken: token,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
    };
  });

  app.post('/api/v1/auth/refresh', async (request, reply) => {
    const parsed = refreshTokenSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const refreshTokenTtlDays = Number(process.env.SV_REFRESH_TOKEN_TTL_DAYS ?? 30);
    const refreshTokenExpiresAt = new Date(Date.now() + refreshTokenTtlDays * 86400000);

    const refreshTokenHash = createHash('sha256').update(parsed.data.refreshToken).digest('hex');
    const session = await prisma.session.findFirst({
      where: { refreshTokenHash },
      select: { id: true, userId: true, expiresAt: true },
    });

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return reply.status(401).send({ error: 'Invalid refresh token' });
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return reply.status(401).send({ error: 'Invalid refresh token' });

    // Rotate refresh token
    const newRefreshToken = randomBytes(32).toString('hex');
    const newRefreshTokenHash = createHash('sha256').update(newRefreshToken).digest('hex');

    await prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: newRefreshTokenHash,
        expiresAt: refreshTokenExpiresAt,
        ip: (request as any).ip ? String((request as any).ip) : undefined,
        userAgent: request.headers['user-agent'] ? String(request.headers['user-agent']) : undefined,
      },
    });

    const accessToken = await reply.jwtSign(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: '15m' },
    );

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: { id: user.id, email: user.email, role: user.role },
    };
  });

  app.get('/api/v1/auth/me', { preHandler: [authPreHandler] }, async (request) => {
    const payload = request.user as { sub: string; email: string; role: string };
    return { user: payload };
  });

  app.get('/api/v1/universes', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const universes = await listUniverses();
    return { universes };
  });

  app.post('/api/v1/universes', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.MANAGE_UNIVERSES);
    const parsed = createUniverseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const universe = await createCustomUniverse(
      parsed.data.name,
      parsed.data.symbols ?? [],
      user.sub !== 'system' ? user.sub : undefined,
    );

    return { universe };
  });

  app.post('/api/v1/screener/run', { preHandler: [authPreHandler, rateLimitPreHandler('screener_run')] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.RUN_SCREENER);
    const parsed = screenerRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const result = await createScreenerJob(
      parsed.data,
      user.sub !== 'system' ? user.sub : undefined,
    );
    return result;
  });

  app.get('/api/v1/screener/jobs/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const { id } = request.params as { id: string };
    const job = await getJob(id);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    const progress = (await getJobProgress(id)) ?? job.progress;
    return { job: { ...job, progress } };
  });


  app.get('/api/v1/screener/jobs/:id/export.csv', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const { id } = request.params as { id: string };
    const job = await getJob(id);
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    if (job.status !== 'done') {
      return reply.status(409).send({ error: 'Job not complete' });
    }
    const result = job.result as { rows?: ScreenerRow[] } | null;
    const rows = result?.rows ?? [];
    const csv = toPitchCsv(rows);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="screener-${id}.csv"`);
    return csv;
  });


  app.get('/api/v1/screener/custom-presets', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const presets = await listUserScreenerPresets(user.sub);
    return { count: presets.length, presets };
  });

  app.get('/api/v1/screener/presets', async () => ({
    presets: listScreenerPresets(),
  }));


  app.get('/api/v1/screener/health', async () => ({
    health: await getScreenerHealthSummary(),
  }));
  app.get('/api/v1/screener/exchange-lists', async () => ({
    exchange_lists: exchangeListSummary(),
  }));

  // --- M12: Screener point-in-time (PIT) backtest (MVP, TA-only)
  app.post('/api/v1/screener/pit-backtest', { preHandler: [authPreHandler, rateLimitPreHandler('screener_pit_backtest')] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.RUN_SCREENER);
    const parsed = screenerPitBacktestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      return await runScreenerPitBacktest({ ...parsed.data, refresh: Boolean(parsed.data.refresh) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PIT backtest failed';
      return reply.status(400).send({ error: message });
    }
  });

  app.get('/api/v1/strategies', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const style = (request.query as { style?: string }).style ?? 'all';
    return listTradingStrategies(style, user.sub !== 'system' ? user.sub : undefined);
  });

  app.get('/api/v1/strategies/daily-proof', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const query = request.query as { days?: string; strategy?: string };
    const days = query.days ? Number(query.days) : 14;
    return listStrategyDailyProof({
      days: Number.isFinite(days) ? days : 14,
      strategy: query.strategy?.trim() || undefined,
    });
  });

  app.post('/api/v1/strategies/daily-proof/run', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.RUN_SCREENER);
    const body = (request.body ?? {}) as { force?: boolean; strategies?: string[]; max_scan?: number };
    try {
      return await runStrategyDailyProofBatch({
        force: body.force !== false,
        strategies: body.strategies,
        maxScan: body.max_scan,
      });
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Strategy daily proof failed',
      });
    }
  });

  // --- M11 (minimal): user custom screener presets stored in `screener_presets`
  app.post('/api/v1/strategies', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.RUN_SCREENER);
    const parsed = userScreenerPresetCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const created = await prisma.screenerPreset.create({
      data: {
        userId: user.sub,
        name: parsed.data.name,
        filters: parsed.data.filters as any,
        isSystem: false,
      },
      select: { id: true, name: true },
    });

    return { id: created.id, key: `user_screener_preset:${created.id}`, name: created.name };
  });

  app.put('/api/v1/strategies/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.RUN_SCREENER);
    const { id } = request.params as { id: string };
    const parsed = userScreenerPresetUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const existing = await prisma.screenerPreset.findFirst({
      where: { id, userId: user.sub, isSystem: false },
    });
    if (!existing) return reply.status(404).send({ error: 'Custom strategy not found' });

    const updated = await prisma.screenerPreset.update({
      where: { id },
      data: {
        name: parsed.data.name ?? existing.name,
        filters: (parsed.data.filters ?? existing.filters) as any,
      },
      select: { id: true, name: true },
    });

    return { id: updated.id, key: `user_screener_preset:${updated.id}`, name: updated.name };
  });

  app.delete('/api/v1/strategies/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.RUN_SCREENER);
    const { id } = request.params as { id: string };

    const existing = await prisma.screenerPreset.findFirst({
      where: { id, userId: user.sub, isSystem: false },
    });
    if (!existing) return reply.status(404).send({ error: 'Custom strategy not found' });

    await prisma.screenerPreset.delete({ where: { id } });
    return { success: true, id };
  });

  // --- M11: custom swing rule profiles (minimal slice)
  app.get('/api/v1/swing/rule-profiles', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const profiles = await prisma.swingRuleProfile.findMany({
      where: { userId: user.sub, isSystem: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, name: true, options: true },
    });
    return { profiles };
  });

  app.post('/api/v1/swing/rule-profiles', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.RUN_SCREENER);
    const parsed = swingRuleProfileCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const created = await prisma.swingRuleProfile.create({
      data: {
        userId: user.sub,
        name: parsed.data.name,
        options: parsed.data.options as any,
        isSystem: false,
      },
      select: { id: true, name: true },
    });

    return { id: created.id, key: `user_swing_rule_profile:${created.id}`, name: created.name };
  });

  app.put('/api/v1/swing/rule-profiles/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.RUN_SCREENER);
    const { id } = request.params as { id: string };
    const parsed = swingRuleProfileUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const existing = await prisma.swingRuleProfile.findFirst({
      where: { id, userId: user.sub, isSystem: false },
      select: { id: true, name: true, options: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Custom swing rule profile not found' });

    const updated = await prisma.swingRuleProfile.update({
      where: { id },
      data: {
        name: parsed.data.name ?? existing.name,
        options: (parsed.data.options ?? existing.options) as any,
      },
      select: { id: true, name: true },
    });

    return { id: updated.id, key: `user_swing_rule_profile:${updated.id}`, name: updated.name };
  });

  app.delete('/api/v1/swing/rule-profiles/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.RUN_SCREENER);
    const { id } = request.params as { id: string };

    const existing = await prisma.swingRuleProfile.findFirst({
      where: { id, userId: user.sub, isSystem: false },
      select: { id: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Custom swing rule profile not found' });

    await prisma.swingRuleProfile.delete({ where: { id } });
    return { success: true, id };
  });

  app.get('/api/v1/strategies/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const { id } = request.params as { id: string };
    const strategy = getTradingStrategy(id);
    if (!strategy) return reply.status(404).send({ error: 'Strategy not found' });
    return { strategy };
  });

  app.post('/api/v1/strategies/run', { preHandler: [authPreHandler, rateLimitPreHandler('strategies_run')] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.RUN_SCREENER);
    const parsed = strategyRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    try {
      const out = await createStrategyRun(
        parsed.data,
        user.sub !== 'system' ? user.sub : undefined,
      );
      if (out.background) {
        return { jobId: out.jobId, background: true, status: out.status };
      }
      return out.result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Strategy run failed';
      return reply.status(400).send({ error: message });
    }
  });

  app.get('/api/v1/strategies/jobs/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const { id } = request.params as { id: string };
    const job = await getStrategyJob(id);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    const progress = (await getJobProgress(id)) ?? job.progress;
    return { job: { ...job, progress } };
  });

  app.post('/api/v1/screener/export', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const body = request.body as { rows?: ScreenerRow[] };
    const rows = body?.rows ?? [];
    const csv = toPitchCsv(rows);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="screener-pitch.csv"');
    return csv;
  });

  app.post('/api/v1/verify/auto', { preHandler: [authPreHandler, rateLimitPreHandler('verify_auto')] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const parsed = verifyAutoSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const result = await verifySymbol(
      parsed.data.symbol,
      parsed.data.refresh,
      user.sub !== 'system' ? user.sub : undefined,
    );
    return result;
  });

  // M13: Batch verify (worker-backed)
  app.post(
    '/api/v1/verify/batch',
    { preHandler: [authPreHandler, rateLimitPreHandler('verify_batch')] },
    async (request, reply) => {
      const user = requirePermission(request, PERMISSIONS.VIEW);
      const parsed = verifyBatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      return createVerifyBatchJob(parsed.data, user.sub !== 'system' ? user.sub : undefined);
    },
  );

  app.get('/api/v1/verify/batch/jobs/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const { id } = request.params as { id: string };
    const job = await getVerifyBatchJob(id);
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    const progress = (await getJobProgress(id)) ?? job.progress;
    return { job: { ...job, progress } };
  });

  app.get('/api/v1/stock/:symbol', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const { symbol } = request.params as { symbol: string };
    const refresh = (request.query as { refresh?: string }).refresh === 'true';
    const normalized = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
    if (!normalized || normalized.length > 20) {
      return reply.status(400).send({ error: 'Invalid symbol' });
    }
    try {
      return await getStockSummary(normalized, refresh);
    } catch (err) {
      return reply.status(404).send({
        error: err instanceof Error ? err.message : 'Stock not found',
      });
    }
  });

  app.get('/api/v1/stock/:symbol/chart', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const { symbol } = request.params as { symbol: string };
    const refresh = (request.query as { refresh?: string }).refresh === 'true';
    const normalized = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
    if (!normalized || normalized.length > 20) {
      return reply.status(400).send({ error: 'Invalid symbol' });
    }
    try {
      return await getStockChart(normalized, refresh);
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Chart load failed',
      });
    }
  });

  app.get('/api/v1/stock/:symbol/patterns/stored', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const { symbol } = request.params as { symbol: string };
    const scanDate = (request.query as { scan_date?: string }).scan_date;
    const normalized = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
    if (!normalized || normalized.length > 20) {
      return reply.status(400).send({ error: 'Invalid symbol' });
    }
    const snapshot = await getLatestChartPatternSnapshot(normalized, scanDate);
    if (!snapshot) {
      return reply.status(404).send({ error: 'No stored chart patterns for this symbol' });
    }
    return snapshot;
  });

  app.get('/api/v1/chart-patterns/feed', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const q = request.query as {
      scan_date?: string;
      kind?: string;
      status?: string;
      type?: string;
      symbol?: string;
      min_confidence?: string;
      limit?: string;
    };
    return queryChartPatternFeed({
      scan_date: q.scan_date,
      kind: q.kind,
      status: q.status,
      type: q.type,
      symbol: q.symbol,
      min_confidence: q.min_confidence != null ? Number(q.min_confidence) : undefined,
      limit: q.limit != null ? Number(q.limit) : undefined,
    });
  });

  app.get('/api/v1/chart-patterns/scan-runs', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const limit = Number((request.query as { limit?: string }).limit ?? 10);
    const runs = await listChartPatternScanRuns(limit);
    return { count: runs.length, runs };
  });

  app.get('/api/v1/chart-patterns/scan-dates', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const limit = Number((request.query as { limit?: string }).limit ?? 30);
    const dates = await listChartPatternScanDates(limit);
    return { count: dates.length, dates };
  });

  app.get('/api/v1/chart-patterns/backtest-summary', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const scanDate = (request.query as { scan_date?: string }).scan_date;
    return getChartPatternBacktestSummary(scanDate);
  });

  app.post('/api/v1/admin/intraday/repair-closed-books', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    try {
      return await repairIntradayClosedBooks();
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Repair failed' });
    }
  });

  app.post('/api/v1/admin/chart-patterns/scan', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const body = (request.body as {
      universe?: string;
      refresh?: boolean;
      max_symbols?: number;
      wait?: boolean;
    } | null) ?? {};
    try {
      const result = await runChartPatternScanJob(body);
      if (result.background) {
        return reply.status(202).send(result);
      }
      return result;
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Chart pattern scan failed',
      });
    }
  });

  app.get('/api/v1/stock/:symbol/profile', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const { symbol } = request.params as { symbol: string };
    const refresh = (request.query as { refresh?: string }).refresh === 'true';
    const normalized = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
    if (!normalized || normalized.length > 20) {
      return reply.status(400).send({ error: 'Invalid symbol' });
    }
    try {
      return await getStockProfile(normalized, refresh);
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Profile load failed',
      });
    }
  });

  app.post('/api/v1/stock/:symbol/refresh', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.REFRESH_DATA);
    const { symbol } = request.params as { symbol: string };
    const normalized = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
    if (!normalized || normalized.length > 20) {
      return reply.status(400).send({ error: 'Invalid symbol' });
    }
    try {
      return await refreshStockCaches(normalized);
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Refresh failed',
      });
    }
  });

  app.get('/api/v1/morning', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const query = request.query as { live?: string; refresh_etf?: string };
    const live = query.live !== '0';
    const refreshEtf = query.refresh_etf === '1';
    try {
      const briefing = await getMorningBriefing(user.sub !== 'system' ? user.sub : undefined, {
        live,
        refreshEtf,
      });
      void notifyMorningAlertsIfNeeded(briefing, user.sub !== 'system' ? user.sub : undefined).catch(() => undefined);
      return briefing;
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Morning briefing failed',
      });
    }
  });

  app.post('/api/v1/morning/refresh-etf', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const query = request.query as { live?: string };
    const live = query.live !== '0';
    try {
      const briefing = await getMorningBriefing(user.sub !== 'system' ? user.sub : undefined, {
        live,
        refreshEtf: true,
      });
      void notifyMorningAlertsIfNeeded(briefing, user.sub !== 'system' ? user.sub : undefined).catch(() => undefined);
      return briefing;
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'ETF refresh failed',
      });
    }
  });

  app.get('/api/v1/signals/evening-gtt', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const query = request.query as { date?: string };
    const digest = await getEveningGttDigest(query.date?.trim() || undefined);
    return digest ?? { date_key: null, order_count: 0, orders: [], disclaimer: 'No evening GTT digest for this date yet.' };
  });

  app.post('/api/v1/signals/evening-gtt/build', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.RUN_SCREENER);
    const body = (request.body ?? {}) as { force?: boolean; send_email?: boolean };
    try {
      return await buildAndPersistEveningGttDigest({
        force: body.force !== false,
        sendEmail: body.send_email === true,
      });
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Evening GTT build failed',
      });
    }
  });

  app.post('/api/v1/signals/exit-alerts/send', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.RUN_SCREENER);
    try {
      return await runOpenPositionExitAlerts({ force: true, skipWeekendGate: true });
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Exit alerts failed',
      });
    }
  });

  app.post('/api/v1/signals/pattern-alerts/send', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.RUN_SCREENER);
    const body = (request.body as { force?: boolean } | null) ?? {};
    try {
      return await dispatchChartPatternAlerts({
        force: body.force !== false,
        userId: user.sub !== 'system' ? user.sub : undefined,
      });
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Pattern alerts failed',
      });
    }
  });

  app.get('/api/v1/signals', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const query = request.query as { live?: string; books?: string; limit?: string };
    const live = query.live !== '0';
    const books = query.books
      ? (query.books.split(',').filter(Boolean) as Array<
          'swing' | 'intraday' | 'watchlist' | 'screener' | 'verify' | 'pattern'
        >)
      : undefined;
    const limit = query.limit ? Number(query.limit) : undefined;
    try {
      return await getSignalsInbox(user.sub !== 'system' ? user.sub : undefined, {
        live,
        books,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Signals inbox failed',
      });
    }
  });

  app.get('/api/v1/trading/presets', { preHandler: [authPreHandler] }, async () => listTradingPresets());

  app.get('/api/v1/trading/economic-gates', { preHandler: [authPreHandler] }, async (request) => {
    const refresh = (request.query as { refresh?: string }).refresh === '1';
    return getEconomicGates(refresh);
  });

  app.get('/api/v1/trading/presets/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = getTradingPresetById(id);
    if (!result) return reply.status(404).send({ error: 'Preset not found' });
    return result;
  });

  app.post('/api/v1/swing/scan', { preHandler: [authPreHandler, rateLimitPreHandler('swing_scan')] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.RUN_SCREENER);
    const parsed = swingScanSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      const result = await createSwingScanJob(parsed.data, user.sub !== 'system' ? user.sub : undefined);
      return result;
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Scan failed' });
    }
  });

  app.post('/api/v1/swing/evaluate', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const parsed = swingEvaluateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const { symbol, refresh, ...filters } = parsed.data;
    const result = await evaluateSwingSymbol(symbol, Boolean(refresh), filters);
    if (!result.ok) return reply.status(404).send(result);
    return result;
  });

  app.post('/api/v1/swing/evaluate-exit', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const parsed = swingEvaluateExitSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const { symbol, entry_price, entry_date, profit_target, target_pct, refresh } = parsed.data;
    const result = await evaluateSwingExit(symbol, entry_price, entry_date, Boolean(refresh), {
      profit_target,
      target_pct,
    });
    if (!result.ok) return reply.status(404).send(result);
    return result;
  });

  app.get('/api/v1/swing/chart/:symbol', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const { symbol } = request.params as { symbol: string };
    const query = request.query as { tf?: string; refresh?: string };
    const normalized = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
    if (!normalized || normalized.length > 20) {
      return reply.status(400).send({ ok: false, error: 'Invalid symbol' });
    }
    const refresh = query.refresh === '1' || query.refresh === 'true';
    const result = await getSwingChart(normalized, query.tf ?? '2y', refresh);
    if (!result.ok) return reply.status(404).send(result);
    return result;
  });

  app.post('/api/v1/swing/backtest', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.RUN_SCREENER);
    const parsed = swingBacktestSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      return await runSwingBacktestJob(parsed.data);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Backtest failed' });
    }
  });

  app.get('/api/v1/watchlist', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    return listWatchlist(user.sub);
  });

  app.put('/api/v1/watchlist/items', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const parsed = watchlistUpsertSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    return upsertWatchlistItem(user.sub, parsed.data);
  });

  app.delete('/api/v1/watchlist/items/:symbol', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const { symbol } = request.params as { symbol: string };
    return removeWatchlistItem(user.sub, symbol);
  });

  app.get('/api/v1/verify/history', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const limit = Number((request.query as { limit?: string }).limit ?? 50);
    return listVerificationHistory(user.sub !== 'system' ? user.sub : undefined, limit);
  });

  app.get('/api/v1/verify/history/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const { id } = request.params as { id: string };
    const run = await getVerificationRun(id, user.sub !== 'system' ? user.sub : undefined);
    if (!run) return reply.status(404).send({ error: 'Not found' });
    return { run };
  });

  app.get('/api/v1/verify/full/prefill', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const symbol = String((request.query as { symbol?: string }).symbol ?? '');
    try {
      return getVerifyFullPrefill(symbol);
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Invalid symbol',
      });
    }
  });

  app.post('/api/v1/verify/full/fetch', { preHandler: [authPreHandler, rateLimitPreHandler('verify_full_fetch')] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const parsed = verifyFullFetchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    try {
      return await fetchVerifyFull(parsed.data.symbol, {
        refresh: parsed.data.refresh,
        manual: parsed.data.manual as Record<string, string | number | boolean> | undefined,
        userId: user.sub !== 'system' ? user.sub : undefined,
      });
    } catch (err) {
      return reply.status(404).send({
        error: err instanceof Error ? err.message : 'Fetch failed',
      });
    }
  });

  app.post('/api/v1/verify/full/run', { preHandler: [authPreHandler, rateLimitPreHandler('verify_full_run')] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const parsed = verifyFullRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    try {
      return await runVerifyFull(
        parsed.data.input as Record<string, string | number | boolean>,
        {
          symbol: parsed.data.symbol,
          userId: user.sub !== 'system' ? user.sub : undefined,
          cacheMeta: parsed.data.cache_meta ?? null,
        },
      );
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Verification failed',
      });
    }
  });

  app.get('/api/v1/verify/full/draft', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    if (user.sub === 'system') return reply.status(400).send({ error: 'Draft requires user session' });
    const symbol = String((request.query as { symbol?: string }).symbol ?? '');
    try {
      const draft = await getVerifyFullDraft(user.sub, symbol);
      return { success: true, draft };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Invalid symbol',
      });
    }
  });

  app.put('/api/v1/verify/full/draft', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    if (user.sub === 'system') return reply.status(400).send({ error: 'Draft requires user session' });
    const parsed = verifyFullDraftSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    try {
      const draft = await saveVerifyFullDraft(
        user.sub,
        parsed.data.symbol,
        parsed.data.input as Record<string, string | number | boolean>,
        parsed.data.auto_keys ?? [],
      );
      return { success: true, draft };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Draft save failed',
      });
    }
  });

  app.get('/api/v1/swing/positions', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const query = request.query as { status?: string; live?: string; date_from?: string; date_to?: string };
    const status = query.status === 'open' || query.status === 'closed' ? query.status : undefined;
    const live = query.live === '1' || query.live === 'true';
    return listSwingPositions(user.sub !== 'system' ? user.sub : undefined, status, {
      live,
      date_from: query.date_from,
      date_to: query.date_to,
    });
  });

  app.get('/api/v1/swing/positions/live', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    return listSwingPositionsLive(user.sub !== 'system' ? user.sub : undefined);
  });

  app.get('/api/v1/swing/positions/export', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const csv = await exportSwingPositionsCsv(user.sub !== 'system' ? user.sub : undefined);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="swing-positions.csv"')
      .send(csv);
  });

  app.get('/api/v1/swing/auto/state', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const query = request.query as { live?: string; positions?: string; include_carried?: string };
    const live = query.live === '1' || query.live === 'true';
    const positions = query.positions !== '0' && query.positions !== 'false';
    const include_carried = query.include_carried === '1' || query.include_carried === 'true';
    return getSwingAutoState(user.sub, { live, positions, include_carried });
  });

  app.get('/api/v1/swing/auto/positions', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const query = request.query as { live?: string };
    const live = query.live === '1' || query.live === 'true';
    return getSwingAutoPositions(user.sub, { live });
  });

  app.get('/api/v1/swing/auto/profile', { preHandler: [authPreHandler] }, async () => getSwingAutoProfile());

  app.get('/api/v1/swing/auto/risk-settings', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    return { ok: true, portfolio_nav: await getSwingPortfolioNav(user.sub) };
  });

  app.get('/api/v1/fundamental-auto/state', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const query = request.query as { universe?: string; maxScan?: string };
    const universe = query.universe ? String(query.universe) : undefined;
    const maxScan = query.maxScan ? Number(query.maxScan) : undefined;
    return getFundamentalAutoState({ universe, maxScan });
  });

  app.post('/api/v1/fundamental-auto/start', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.RUN_SCREENER);
    const body = (request.body ?? {}) as { universe?: string; maxScan?: number; refresh?: boolean };
    try {
      const result = await startFundamentalAutoScan({
        universe: body.universe ? String(body.universe) : undefined,
        maxScan: typeof body.maxScan === 'number' ? body.maxScan : undefined,
        refresh: Boolean(body.refresh),
      });
      if (!('ok' in result) || !result.ok) {
        return reply.status(400).send({ error: (result as { error?: string }).error ?? 'LTG start failed' });
      }
      return result.snapshot;
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'LTG start failed' });
    }
  });

  app.post('/api/v1/swing/auto/risk-settings', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const nav = Number((request.body as { portfolio_nav?: unknown } | null)?.portfolio_nav);
    const result = await setSwingPortfolioNav(user.sub, nav);
    if (!result.ok) return reply.status(400).send(result);
    return result;
  });

  app.post('/api/v1/swing/auto/check-add', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return validateSwingAddPosition(user.sub, body);
  });

  app.post('/api/v1/swing/auto/scan', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const parsed = swingAutoScanSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const result = await startSwingAutoScan(user.sub, {
      force: parsed.data.force ?? true,
      full: parsed.data.full ?? true,
    });
    if (!result.ok) return reply.status(409).send(result);
    return result;
  });

  app.get('/api/v1/swing/paper/state', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    return getSwingPaperState(user.sub);
  });

  app.post('/api/v1/swing/paper/arm', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const parsed = paperWalletArmSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    return setSwingPaperAutoArmed(user.sub, parsed.data.armed);
  });

  app.post('/api/v1/swing/paper/tick', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    return tickSwingPaperUser(user.sub);
  });

  app.post('/api/v1/swing/paper/archive', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const parsed = swingPaperArchiveSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const result = await archiveSwingPaperPeriod(user.sub, parsed.data);
    if (!result.ok) return reply.status(409).send(result);
    return result;
  });

  app.get('/api/v1/ops/alerts', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    return collectOpsAlerts(user.sub);
  });

  app.get('/api/v1/intraday/instruments', { preHandler: [authPreHandler] }, async () => {
    return getIntradayInstruments();
  });

  app.get('/api/v1/intraday/nifty/state', { preHandler: [authPreHandler] }, async (request, reply) => {
    const query = request.query as {
      interval?: string;
      refresh?: string;
      instrument?: string;
      index?: string;
      symbol?: string;
      positions?: string;
    };
    const interval = query.interval === '5m' ? '5m' : '15m';
    const refresh = query.refresh === '1';
    const instrument = (query.symbol ?? query.instrument ?? query.index ?? 'nifty50').trim() || 'nifty50';
    const state = await getNiftyIntradayState(interval, refresh, instrument);
    if ('unknown_instrument' in state && state.unknown_instrument) return reply.status(404).send(state);
    return {
      ...state,
      positions_included: false,
      positions_skipped: query.positions === '0' || query.positions === 'false',
    };
  });

  app.get('/api/v1/intraday/nifty/lite', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const query = request.query as {
      interval?: string;
      refresh?: string;
      instrument?: string;
      index?: string;
      symbol?: string;
      tf?: string;
      positions?: string;
      journal?: string;
    };
    const iv = query.interval ?? query.tf;
    const interval = iv === '15m' ? '15m' : '5m';
    const refresh = query.refresh === '1';
    const instrument = (query.symbol ?? query.instrument ?? query.index ?? 'nifty50').trim() || 'nifty50';
    const lite = await getNiftyIntradayLite(user.sub, interval, instrument, refresh, {
      includePositions: intradayIncludeFlag(query.positions),
      includeJournal: intradayIncludeFlag(query.journal),
    });
    if ('unknown_instrument' in lite && lite.unknown_instrument) return reply.status(404).send(lite);
    return lite;
  });

  app.get('/api/v1/intraday/chart/:instrument', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const { instrument } = request.params as { instrument: string };
    const query = request.query as { interval?: string; refresh?: string };
    const interval = query.interval === '5m' ? '5m' : '15m';
    const refresh = query.refresh === '1' || query.refresh === 'true';
    const result = await getIntradayChart(instrument, interval, refresh);
    if (!result.ok) return reply.status(404).send(result);
    return result;
  });

  app.post('/api/v1/intraday/backtests', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.RUN_SCREENER);
    const parsed = intradayBacktestSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      return await runIntradayBacktestJob(parsed.data);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Backtest failed' });
    }
  });

  app.get('/api/v1/intraday/positions', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const query = request.query as { status?: string; live?: string; date_from?: string; date_to?: string };
    const status = query.status === 'open' || query.status === 'closed' ? query.status : undefined;
    const live = query.live === '1' || query.live === 'true';
    return listIntradayPositions(user.sub !== 'system' ? user.sub : undefined, status, {
      live,
      date_from: query.date_from,
      date_to: query.date_to,
    });
  });

  app.get('/api/v1/intraday/positions/export', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const query = request.query as { limit?: string; date_from?: string; date_to?: string };
    const limit = query.limit ? Number(query.limit) : undefined;
    const csv = await exportIntradayPositionsCsv(user.sub !== 'system' ? user.sub : undefined, {
      limit: Number.isFinite(limit) ? limit : undefined,
      date_from: query.date_from,
      date_to: query.date_to,
    });
    const day = new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="intraday-closed-${day}.csv"`)
      .send(csv);
  });

  app.post('/api/v1/intraday/positions', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const parsed = niftyIntradayPositionCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      return await createIntradayPosition(user.sub, parsed.data);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Create failed' });
    }
  });

  app.patch('/api/v1/intraday/positions/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const { id } = request.params as { id: string };
    const parsed = niftyIntradayPositionUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      const result = await updateIntradayPosition(user.sub, id, parsed.data);
      if (!result) return reply.status(404).send({ error: 'Open position not found' });
      return result;
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Update failed' });
    }
  });

  app.post('/api/v1/intraday/positions/:id/close', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const { id } = request.params as { id: string };
    const parsed = niftyIntradayPositionCloseSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      const result = await closeIntradayPosition(user.sub, id, parsed.data.closed_price, parsed.data.closed_reason);
      if (!result) return reply.status(404).send({ error: 'Open position not found' });
      return result;
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Close failed' });
    }
  });

  app.post('/api/v1/intraday/positions/:id/reopen', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const { id } = request.params as { id: string };
    const result = await reopenIntradayPosition(user.sub, id);
    if (!result) return reply.status(404).send({ error: 'Closed position not found' });
    if ('error' in result && result.error === 'undo_expired') {
      return reply.status(410).send({ error: 'Undo window expired (5 minutes)' });
    }
    return result;
  });

  app.get('/api/v1/intraday/paper/wallet', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    return getPaperWalletState(user.sub);
  });

  app.post('/api/v1/intraday/paper/fund', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const wallet = await ensurePaperWallet(user.sub);
    return { ok: true, wallet, funded_inr: wallet.opening_balance };
  });

  app.post('/api/v1/intraday/paper/arm', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const parsed = paperWalletArmSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const wallet = await setPaperAutoArmed(user.sub, parsed.data.armed);
    return { ok: true, wallet };
  });

  app.post('/api/v1/intraday/paper/tick', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    return tickPaperUser(user.sub);
  });

  app.post('/api/v1/intraday/paper/positions/:id/close', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const { id } = request.params as { id: string };
    const parsed = paperPositionCloseSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const state = await getPaperWalletState(user.sub);
    const open = state.open_positions.find((p) => p.id === id);
    if (!open) return reply.status(404).send({ error: 'Open paper position not found' });
    const px = parsed.data.closed_price ?? Number(open.entry_price);
    try {
      const result = await closePaperPosition(
        user.sub,
        id,
        px,
        parsed.data.closed_reason ?? 'manual',
      );
      if (!result) return reply.status(404).send({ error: 'Open paper position not found' });
      return { ok: true, position: result };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Close failed' });
    }
  });

  app.post('/api/v1/swing/positions', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const parsed = swingPositionCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    if (parsed.data.source === 'auto_radar') {
      const gate = await validateSwingAddPosition(user.sub, parsed.data);
      if (!gate.ok) return reply.status(409).send(gate);
    }
    return createSwingPosition(user.sub, parsed.data);
  });

  app.post('/api/v1/swing/positions/:id/close', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const { id } = request.params as { id: string };
    const parsed = swingPositionCloseSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const result = await closeSwingPosition(user.sub, id, parsed.data.closed_price, parsed.data.closed_reason);
    if (!result) return reply.status(404).send({ error: 'Open position not found' });
    return result;
  });

  app.post('/api/v1/swing/positions/:id/reopen', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const { id } = request.params as { id: string };
    const result = await reopenSwingPosition(user.sub, id);
    if (!result) return reply.status(404).send({ error: 'Closed position not found' });
    if ('error' in result && result.error === 'undo_expired') {
      return reply.status(410).send({ error: 'Undo window expired (5 minutes)' });
    }
    return result;
  });

  app.patch('/api/v1/swing/positions/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const { id } = request.params as { id: string };
    const parsed = swingPositionUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const result = await updateSwingPosition(user.sub, id, parsed.data);
    if (!result) return reply.status(404).send({ error: 'Open position not found' });
    return result;
  });

  app.delete('/api/v1/swing/positions/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const { id } = request.params as { id: string };
    const result = await deleteSwingPosition(user.sub, id);
    if (!result) return reply.status(404).send({ error: 'Position not found' });
    return result;
  });

  app.get('/api/v1/admin/status', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    let postgresOk = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      postgresOk = true;
    } catch {
      postgresOk = false;
    }
    const redisOk = await pingRedis();
    const workerOk = await hasActiveWorker();
    return {
      status: postgresOk && redisOk ? 'ready' : 'degraded',
      checks: {
        postgres: { ok: postgresOk },
        redis: { ok: redisOk },
        worker: { ok: workerOk, detail: workerOk ? 'heartbeat seen' : 'no worker heartbeat' },
      },
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/api/v1/admin/cache/stats', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const stats = await cacheStats();
    return { stats, scopes: ADMIN_CACHE_SCOPES };
  });

  app.get('/api/v1/admin/cache/keys', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const { prefix = 'sv:', limit = '50' } = request.query as { prefix?: string; limit?: string };
    const validated = validateAdminCachePrefix(prefix);
    if ('error' in validated) return reply.status(400).send({ error: validated.error });
    const keys = await cacheListKeys(validated.prefix, Math.min(500, parseInt(limit, 10) || 50));
    return { prefix: validated.prefix, scope: validated.scope, keys, count: keys.length };
  });

  app.get('/api/v1/admin/cache/value', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const { prefix, key } = request.query as { prefix?: string; key?: string };
    const validated = validateAdminCachePrefix(prefix);
    if ('error' in validated) return reply.status(400).send({ error: validated.error });
    const normalizedKey = String(key ?? '').trim();
    if (!normalizedKey || normalizedKey.includes('*') || normalizedKey.includes('?')) {
      return reply.status(400).send({ error: 'key query required. Wildcards are not allowed.' });
    }
    if (normalizedKey !== validated.prefix && !normalizedKey.startsWith(`${validated.prefix}:`)) {
      return reply.status(400).send({ error: 'Key must belong to the selected cache scope.' });
    }
    const preview = await cachePreviewKey(normalizedKey);
    return { prefix: validated.prefix, scope: validated.scope, preview };
  });

  app.delete('/api/v1/admin/cache', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const { prefix, confirm } = request.query as { prefix?: string; confirm?: string };
    const validated = validateAdminCachePrefix(prefix);
    if ('error' in validated) return reply.status(400).send({ error: validated.error });
    if (!validated.scope.clearable) {
      return reply.status(403).send({ error: `${validated.scope.label} is operational and cannot be cleared from Admin.` });
    }
    if (confirm !== validated.prefix) {
      return reply.status(400).send({ error: `Confirmation must exactly match ${validated.prefix}` });
    }
    const deleted = await cacheClearPrefix(validated.prefix);
    return { success: true, prefix: validated.prefix, scope: validated.scope, deleted };
  });

  app.get('/api/v1/admin/settings', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    return getEffectiveSettings();
  });

  app.post('/api/v1/admin/config/reload', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    try {
      return await reloadConfigAndNotifyWorkers();
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Config reload failed',
      });
    }
  });

  app.get('/api/v1/admin/whatsapp/status', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    return getWhatsAppStatus();
  });

  app.post('/api/v1/admin/whatsapp/test', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    try {
      const result = await sendWhatsAppTestMessage();
      return { ok: result.sent, ...result };
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'WhatsApp test failed',
      });
    }
  });

  app.get('/api/v1/admin/smtp/status', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    return getSmtpStatus();
  });

  app.post('/api/v1/admin/smtp/test', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    try {
      return await sendTestSignalEmail();
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'SMTP test failed',
      });
    }
  });

  app.get('/api/v1/admin/risk-policy', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    return getResearchRiskPolicy();
  });

  app.patch('/api/v1/admin/settings', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const body = request.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') {
      return reply.status(400).send({ error: 'JSON body required' });
    }
    try {
      return await patchAppSettings(body, user.sub);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid settings' });
    }
  });

  app.get('/api/v1/admin/sync/status', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    return fetchDailySyncStatus();
  });

  app.post('/api/v1/admin/sync/daily', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const body = (request.body as { force?: boolean; wait?: boolean } | null) ?? {};
    try {
      // Default: background (202) so nginx/browser do not 504 on multi-minute prefetch.
      const background = body.wait !== true;
      const result = await runDailySyncJob(user.sub, Boolean(body.force), background);
      if (background && result && 'accepted' in result && result.accepted) {
        return reply.status(202).send(result);
      }
      return result;
    } catch (err) {
      return reply.status(409).send({ error: err instanceof Error ? err.message : 'Daily sync failed' });
    }
  });

  app.get('/api/v1/admin/uploads/stats', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    return getAdminStats();
  });

  app.post('/api/v1/admin/uploads/nse-equity', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'CSV file required' });
    const csv = (await file.toBuffer()).toString('utf8');
    const result = await importNseEquityCsv(csv);
    if (!result.success) return reply.status(400).send(result);
    return result;
  });

  app.post('/api/v1/admin/uploads/etfs', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const q = request.query as { mode?: string };
    const mode = q.mode === 'replace' ? 'replace' : 'merge';
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'CSV file required' });
    const csv = (await file.toBuffer()).toString('utf8');
    const result = await importEtfCsv(csv, mode);
    if (!result.success) return reply.status(400).send(result);
    return result;
  });

  app.post('/api/v1/admin/uploads/promoter-holding', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'CSV file required' });
    const csv = (await file.toBuffer()).toString('utf8');
    const result = await importPromoterHoldingCsv(csv);
    if (!result.success) return reply.status(400).send(result);
    return result;
  });

  app.post('/api/v1/admin/uploads/promoter-pledge', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'CSV file required' });
    const csv = (await file.toBuffer()).toString('utf8');
    const result = await importPromoterPledgeCsv(csv);
    if (!result.success) return reply.status(400).send(result);
    return result;
  });

  app.get('/api/v1/admin/indices/status', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    return { indices: await getIndexStatus() };
  });

  app.post('/api/v1/admin/indices/sync', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const body = (request.body ?? {}) as { keys?: string[] };
    const result = await syncIndicesFromDisk(body.keys);
    if (!result.success) return reply.status(400).send(result);
    return result;
  });

  app.post('/api/v1/admin/indices/upload', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const q = request.query as { indexKey?: string };
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'CSV file required' });
    const csv = (await file.toBuffer()).toString('utf8');
    const result = await importIndexCsv(file.filename, csv, q.indexKey);
    if (!result.success) return reply.status(400).send(result);
    return result;
  });

  app.get('/api/v1/cfa/terms', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const q = request.query as { category?: string };
    const terms = await listCfaTerms({ category: q.category, activeOnly: true });
    return { terms, categories: cfaTermCategories(terms) };
  });

  app.get('/api/v1/cfa/terms/:key', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const { key } = request.params as { key: string };
    const term = await getCfaTerm(key);
    if (!term) return reply.status(404).send({ error: 'Term not found' });
    return { term };
  });

  app.get('/api/v1/admin/cfa/terms', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const q = request.query as { category?: string };
    const terms = await listCfaTerms({ category: q.category, includeInactive: true });
    return { terms, categories: cfaTermCategories(terms) };
  });

  app.post('/api/v1/admin/cfa/terms', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const parsed = cfaTermUpsertSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const term = await upsertCfaTerm(parsed.data, user.sub);
    return { term };
  });

  app.put('/api/v1/admin/cfa/terms/:key', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const { key } = request.params as { key: string };
    const parsed = cfaTermUpsertSchema.safeParse({ ...(request.body as object), key });
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const term = await upsertCfaTerm(parsed.data, user.sub);
    return { term };
  });

  app.delete('/api/v1/admin/cfa/terms/:key', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const { key } = request.params as { key: string };
    const ok = await deleteCfaTerm(key);
    if (!ok) return reply.status(404).send({ error: 'Term not found' });
    return { success: true };
  });

  app.post('/api/v1/admin/cfa/terms/reseed', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const result = await reseedCfaTerms(user.sub);
    const terms = await listCfaTerms({ includeInactive: true });
    return { ...result, count: terms.length };
  });

  app.get('/api/v1/presets', async () => ({
    presets: listScreenerPresets().map((p) => p.id),
  }));

  app.get('/ws/jobs/:id', { websocket: true }, (socket, request) => {
    const jobId = (request.params as { id: string }).id;
    const redis = getRedis();
    const channel = `job:${jobId}`;

    const sub = redis.duplicate();
    void sub.subscribe(channel);

    sub.on('message', (_ch, message) => {
      socket.send(message);
    });

    void getJobProgress(jobId).then((progress) => {
      if (progress) socket.send(JSON.stringify(progress));
    });

    socket.on('close', () => {
      void sub.unsubscribe(channel);
      void sub.quit();
    });
  });

  return app;
}

async function main() {
  await connectRedis().catch(() => undefined);
  await bootstrapAppConfig().catch(() => initAppConfig());
  const app = await buildApp();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`API listening on :${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
