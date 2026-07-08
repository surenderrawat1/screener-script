import './load-env.js';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import bcrypt from 'bcryptjs';
import { prisma } from '@sv/db';
import {
  connectRedis,
  pingRedis,
  cacheStats,
  cacheListKeys,
  cacheClearPrefix,
  getJobProgress,
  getRedis,
  hasActiveWorker,
  redisHostLabel,
} from '@sv/cache';
import {
  loginSchema,
  screenerRunSchema,
  verifyAutoSchema,
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
  swingScanSchema,
  swingAutoScanSchema,
  swingEvaluateSchema,
  swingEvaluateExitSchema,
  swingBacktestSchema,
  strategyRunSchema,
  intradayBacktestSchema,
  PERMISSIONS,
  initAppConfig,
  type ScreenerRow,
} from '@sv/shared';
import { toPitchCsv } from '@sv/core';
import { requirePermission } from './lib/auth.js';
import { listUniverses, createCustomUniverse } from './services/universe.js';
import { createScreenerJob, getJob } from './services/screener.js';
import { listScreenerPresets } from './services/screener-presets.js';
import { createStrategyRun, getJob as getStrategyJob, getTradingStrategy, listTradingStrategies } from './services/strategies.js';
import { exchangeListSummary } from '@sv/data-adapters';
import { createSwingScanJob } from './services/swing.js';
import { runSwingBacktestJob } from './services/swing-backtest.js';
import { verifySymbol } from './services/verify.js';
import { getVerifyFullPrefill, fetchVerifyFull, runVerifyFull, getVerifyFullDraft, saveVerifyFullDraft } from './services/verify-full.js';
import { getAdminStats, importIndexCsv, importNseEquityCsv, importPromoterHoldingCsv, getIndexStatus, syncIndicesFromDisk } from './services/admin.js';
import {
  cfaTermCategories,
  deleteCfaTerm,
  getCfaTerm,
  listCfaTerms,
  reseedCfaTerms,
  upsertCfaTerm,
} from './services/cfa-docs.js';
import { bootstrapAppConfig, getEffectiveSettings, patchAppSettings } from './services/settings.js';
import { fetchDailySyncStatus, runDailySyncJob } from './services/daily-sync.js';
import { getStockSummary, getStockChart, getStockProfile, refreshStockCaches } from './services/stock-details.js';
import { getMorningBriefing, notifyMorningAlertsIfNeeded } from './services/morning.js';
import { getTradingPresetById, listTradingPresets } from './services/trading-presets.js';
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
  validateSwingAddPosition,
  startSwingAutoScan,
} from './services/swing-auto.js';
import { getNiftyIntradayState, getIntradayInstruments, getIntradayChart } from './services/intraday.js';
import { runIntradayBacktestJob } from './services/intraday-backtest.js';
import {
  listIntradayPositions,
  createIntradayPosition,
  closeIntradayPosition,
  reopenIntradayPosition,
} from './services/intraday-positions.js';

const PORT = parseInt(process.env.API_PORT ?? '3100', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

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

    const token = await reply.jwtSign(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: '15m' },
    );

    return {
      accessToken: token,
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

  app.post('/api/v1/screener/run', { preHandler: [authPreHandler] }, async (request, reply) => {
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

  app.get('/api/v1/screener/presets', async () => ({
    presets: listScreenerPresets(),
  }));

  app.get('/api/v1/screener/exchange-lists', async () => ({
    exchange_lists: exchangeListSummary(),
  }));

  app.get('/api/v1/strategies', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const style = (request.query as { style?: string }).style ?? 'all';
    return listTradingStrategies(style);
  });

  app.get('/api/v1/strategies/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.VIEW);
    const { id } = request.params as { id: string };
    const strategy = getTradingStrategy(id);
    if (!strategy) return reply.status(404).send({ error: 'Strategy not found' });
    return { strategy };
  });

  app.post('/api/v1/strategies/run', { preHandler: [authPreHandler] }, async (request, reply) => {
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

  app.post('/api/v1/verify/auto', { preHandler: [authPreHandler] }, async (request, reply) => {
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
      void notifyMorningAlertsIfNeeded(briefing).catch(() => undefined);
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
      void notifyMorningAlertsIfNeeded(briefing).catch(() => undefined);
      return briefing;
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'ETF refresh failed',
      });
    }
  });

  app.get('/api/v1/trading/presets', { preHandler: [authPreHandler] }, async () => listTradingPresets());

  app.get('/api/v1/trading/presets/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = getTradingPresetById(id);
    if (!result) return reply.status(404).send({ error: 'Preset not found' });
    return result;
  });

  app.post('/api/v1/swing/scan', { preHandler: [authPreHandler] }, async (request, reply) => {
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

  app.post('/api/v1/verify/full/fetch', { preHandler: [authPreHandler] }, async (request, reply) => {
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

  app.post('/api/v1/verify/full/run', { preHandler: [authPreHandler] }, async (request, reply) => {
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
    const query = request.query as { status?: string; live?: string };
    const status = query.status === 'open' || query.status === 'closed' ? query.status : undefined;
    const live = query.live === '1' || query.live === 'true';
    return listSwingPositions(user.sub !== 'system' ? user.sub : undefined, status, { live });
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

  app.get('/api/v1/intraday/instruments', { preHandler: [authPreHandler] }, async () => {
    return getIntradayInstruments();
  });

  app.get('/api/v1/intraday/nifty/state', { preHandler: [authPreHandler] }, async (request) => {
    const query = request.query as { interval?: string; refresh?: string; instrument?: string; index?: string };
    const interval = query.interval === '5m' ? '5m' : '15m';
    const refresh = query.refresh === '1';
    const instrument = query.instrument ?? query.index ?? 'nifty50';
    return getNiftyIntradayState(interval, refresh, instrument);
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
    const query = request.query as { status?: string; live?: string };
    const status = query.status === 'open' || query.status === 'closed' ? query.status : undefined;
    const live = query.live === '1' || query.live === 'true';
    return listIntradayPositions(user.sub !== 'system' ? user.sub : undefined, status, { live });
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

  app.post('/api/v1/intraday/positions/:id/close', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const { id } = request.params as { id: string };
    const parsed = niftyIntradayPositionCloseSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const result = await closeIntradayPosition(user.sub, id, parsed.data.closed_price, parsed.data.closed_reason);
    if (!result) return reply.status(404).send({ error: 'Open position not found' });
    return result;
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

  app.post('/api/v1/swing/positions', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const parsed = swingPositionCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
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

  app.get('/api/v1/admin/cache/stats', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const stats = await cacheStats();
    return { stats };
  });

  app.get('/api/v1/admin/cache/keys', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const { prefix = 'sv:', limit = '50' } = request.query as { prefix?: string; limit?: string };
    if (!prefix.startsWith('sv:')) {
      return reply.status(400).send({ error: 'prefix must start with sv:' });
    }
    const keys = await cacheListKeys(prefix, Math.min(500, parseInt(limit, 10) || 50));
    return { prefix, keys, count: keys.length };
  });

  app.delete('/api/v1/admin/cache', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const { prefix } = request.query as { prefix?: string };
    if (!prefix?.startsWith('sv:')) {
      return reply.status(400).send({ error: 'prefix query required (must start with sv:)' });
    }
    const deleted = await cacheClearPrefix(prefix);
    return { success: true, prefix, deleted };
  });

  app.get('/api/v1/admin/settings', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    return getEffectiveSettings();
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
    const body = (request.body as { force?: boolean } | null) ?? {};
    try {
      return await runDailySyncJob(user.sub, Boolean(body.force));
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

  app.post('/api/v1/admin/uploads/promoter-holding', { preHandler: [authPreHandler] }, async (request, reply) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'CSV file required' });
    const csv = (await file.toBuffer()).toString('utf8');
    const result = await importPromoterHoldingCsv(csv);
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
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'CSV file required' });
    const csv = (await file.toBuffer()).toString('utf8');
    const result = await importIndexCsv(file.filename, csv);
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
