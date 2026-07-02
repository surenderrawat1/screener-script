import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

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
  getJobProgress,
  getRedis,
  hasActiveWorker,
} from '@sv/cache';
import {
  loginSchema,
  screenerRunSchema,
  verifyAutoSchema,
  createUniverseSchema,
  PERMISSIONS,
} from '@sv/shared';
import { requirePermission } from './lib/auth.js';
import { listUniverses, createCustomUniverse } from './services/universe.js';
import { createScreenerJob, getJob } from './services/screener.js';
import { verifySymbol } from './services/verify.js';
import { getAdminStats, importNseEquityCsv, importPromoterHoldingCsv } from './services/admin.js';

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

    const ok = pgOk && redisOk;
    return reply.status(ok ? 200 : 503).send({
      status: ok ? 'ready' : 'degraded',
      checks: {
        postgres: { ok: pgOk, host: 'shared_postgres' },
        redis: { ok: redisOk, host: 'shared_redis' },
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

  app.get('/api/v1/admin/cache/stats', { preHandler: [authPreHandler] }, async (request) => {
    requirePermission(request, PERMISSIONS.MANAGE_CACHE);
    const stats = await cacheStats();
    return { stats };
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
  const app = await buildApp();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`API listening on :${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
