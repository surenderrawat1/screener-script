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
  createUniverseSchema,
  watchlistUpsertSchema,
  swingPositionCreateSchema,
  swingPositionCloseSchema,
  swingScanSchema,
  PERMISSIONS,
  initAppConfig,
} from '@sv/shared';
import { requirePermission } from './lib/auth.js';
import { listUniverses, createCustomUniverse } from './services/universe.js';
import { createScreenerJob, getJob } from './services/screener.js';
import { createSwingScanJob } from './services/swing.js';
import { verifySymbol } from './services/verify.js';
import { getAdminStats, importIndexCsv, importNseEquityCsv, importPromoterHoldingCsv, getIndexStatus, syncIndicesFromDisk } from './services/admin.js';
import { bootstrapAppConfig, getEffectiveSettings, patchAppSettings } from './services/settings.js';
import { fetchDailySyncStatus, runDailySyncJob } from './services/daily-sync.js';
import { getStockSummary, getStockChart, getStockProfile, refreshStockCaches } from './services/stock-details.js';
import { evaluateSwingSymbol } from '@sv/data-adapters';
import {
  listWatchlist,
  upsertWatchlistItem,
  removeWatchlistItem,
} from './services/watchlist.js';
import { listVerificationHistory, getVerificationRun } from './services/verification-history.js';
import {
  listSwingPositions,
  createSwingPosition,
  closeSwingPosition,
} from './services/swing-positions.js';
import { getSwingAutoState, getSwingAutoProfile, validateSwingAddPosition, refreshOpenPositions, startSwingAutoScan } from './services/swing-auto.js';
import { getNiftyIntradayState } from './services/intraday.js';

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
    const body = request.body as { symbol?: string; refresh?: boolean };
    const symbol = String(body.symbol ?? '').trim();
    if (!symbol) return reply.status(400).send({ error: 'symbol required' });
    const result = await evaluateSwingSymbol(symbol, Boolean(body.refresh));
    if (!result.ok) return reply.status(404).send(result);
    return result;
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

  app.get('/api/v1/swing/positions', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const query = request.query as { status?: string; live?: string };
    const status = query.status === 'open' || query.status === 'closed' ? query.status : undefined;
    const result = await listSwingPositions(user.sub !== 'system' ? user.sub : undefined, status);
    if (query.live === '1' && status === 'open') {
      const live = await refreshOpenPositions(result.positions, true);
      return { ...result, positions: live };
    }
    return result;
  });

  app.get('/api/v1/swing/auto/state', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    return getSwingAutoState(user.sub);
  });

  app.get('/api/v1/swing/auto/profile', { preHandler: [authPreHandler] }, async () => getSwingAutoProfile());

  app.post('/api/v1/swing/auto/check-add', { preHandler: [authPreHandler] }, async (request) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const regime = (body.regime as Record<string, unknown> | undefined) ?? null;
    return validateSwingAddPosition(user.sub, body, regime);
  });

  app.post('/api/v1/swing/auto/scan', { preHandler: [authPreHandler] }, async (request, reply) => {
    const user = requirePermission(request, PERMISSIONS.VIEW);
    const result = await startSwingAutoScan(user.sub);
    if (!result.ok) return reply.status(409).send(result);
    return result;
  });

  app.get('/api/v1/intraday/nifty/state', { preHandler: [authPreHandler] }, async (request) => {
    const query = request.query as { interval?: string; refresh?: string };
    const interval = query.interval === '5m' ? '5m' : '15m';
    const refresh = query.refresh === '1';
    return getNiftyIntradayState(interval, refresh);
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

  app.get('/api/v1/presets', async () => ({
    presets: [
      'quality',
      'strong_buy',
      'buy_picks',
      'fair_mos',
      'value',
      'growth',
      'cfa_top',
    ],
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
