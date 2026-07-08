import { Redis } from 'ioredis';
import { CACHE_PREFIX, CACHE_TTL } from '@sv/shared';

let client: Redis | null = null;
let connectPromise: Promise<Redis> | null = null;

export function getRedisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/1';
}

export function redisHostLabel(): string {
  try {
    return new URL(getRedisUrl()).hostname;
  } catch {
    return 'unknown';
  }
}

function createRedisClient(): Redis {
  const redis = new Redis(getRedisUrl(), {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 200, 3000),
    reconnectOnError: () => true,
  });
  redis.on('error', (err) => {
    console.warn('[redis]', err.message);
  });
  redis.on('end', () => {
    if (client === redis) {
      client = null;
      connectPromise = null;
    }
  });
  return redis;
}

export function resetRedisClient(): void {
  if (!client) return;
  const stale = client;
  client = null;
  connectPromise = null;
  stale.removeAllListeners();
  stale.disconnect();
}

export function getRedis(): Redis {
  if (!client) {
    client = createRedisClient();
  }
  return client;
}

export async function connectRedis(): Promise<Redis> {
  const existing = client;
  if (existing?.status === 'ready') {
    return existing;
  }

  if (!connectPromise) {
    connectPromise = (async () => {
      if (client && client.status !== 'ready') {
        resetRedisClient();
      }
      const redis = getRedis();
      if (redis.status === 'ready') {
        return redis;
      }
      try {
        await redis.connect();
        return redis;
      } catch (err) {
        resetRedisClient();
        console.warn(
          '[cache] Redis unavailable — will retry on first use:',
          (err as Error).message,
        );
        return getRedis();
      }
    })().finally(() => {
      connectPromise = null;
    });
  }

  return connectPromise;
}

async function ensureRedis(): Promise<Redis> {
  const redis = await connectRedis();
  if (redis.status === 'ready') {
    return redis;
  }
  resetRedisClient();
  const next = getRedis();
  await next.connect();
  return next;
}

export async function pingRedis(): Promise<boolean> {
  try {
    const redis = await ensureRedis();
    return (await redis.ping()) === 'PONG';
  } catch {
    resetRedisClient();
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  resetRedisClient();
}

export function cacheKey(prefix: string, ...parts: string[]): string {
  return [prefix, ...parts.map((p) => p.toUpperCase())].join(':');
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  try {
    const redis = await ensureRedis();
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  } catch {
    resetRedisClient();
    return null;
  }
}

export async function cacheSetJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  try {
    const redis = await ensureRedis();
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    resetRedisClient();
  }
}

export async function cacheDel(pattern: string): Promise<number> {
  try {
    const redis = await ensureRedis();
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        deleted += await redis.del(...keys);
      }
    } while (cursor !== '0');
    return deleted;
  } catch {
    resetRedisClient();
    return 0;
  }
}

export async function cacheDeleteKey(key: string): Promise<boolean> {
  try {
    const redis = getRedis();
    return (await redis.del(key)) > 0;
  } catch {
    return false;
  }
}

/** Clear all warmed caches for one NSE symbol (stock, verify, TA, screener, Yahoo). */
export async function cacheClearSymbol(symbol: string): Promise<number> {
  const sym = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  if (!sym) return 0;
  const slug = sym.toLowerCase();

  const keys = [
    cacheKey(CACHE_PREFIX.STOCK, sym),
    cacheKey(CACHE_PREFIX.VERIFY, sym),
    cacheKey(CACHE_PREFIX.TA, `bars:${sym}`),
    cacheKey(CACHE_PREFIX.SCREENER_ROW, sym),
    cacheKey(CACHE_PREFIX.SCREENER_TABLE, slug),
    cacheKey(CACHE_PREFIX.SCREENER_TABLE, `profile:consolidated:${slug}`),
    cacheKey(CACHE_PREFIX.SCREENER_TABLE, `profile:standalone:${slug}`),
    cacheKey(CACHE_PREFIX.YAHOO, `${sym}.NS`),
    cacheKey(CACHE_PREFIX.YAHOO, `${sym}.BO`),
  ];

  let deleted = 0;
  for (const key of keys) {
    try {
      if (await cacheDeleteKey(key)) deleted += 1;
    } catch {
      // Redis unavailable — continue best-effort
    }
  }
  return deleted;
}

export async function getStockCache(symbol: string): Promise<Record<string, unknown> | null> {
  const key = cacheKey(CACHE_PREFIX.STOCK, symbol);
  return cacheGetJson(key);
}

export async function setStockCache(
  symbol: string,
  data: Record<string, unknown>,
  ttl = CACHE_TTL.stock,
): Promise<void> {
  const key = cacheKey(CACHE_PREFIX.STOCK, symbol);
  await cacheSetJson(key, data, ttl);
}

export async function setJobProgress(
  jobId: string,
  progress: Record<string, unknown>,
): Promise<void> {
  const key = cacheKey(CACHE_PREFIX.JOB_PROGRESS, jobId);
  await cacheSetJson(key, progress, CACHE_TTL.job_progress);
  try {
    const redis = await ensureRedis();
    await redis.publish(`job:${jobId}`, JSON.stringify(progress));
  } catch {
    resetRedisClient();
  }
}

export async function getJobProgress(
  jobId: string,
): Promise<Record<string, unknown> | null> {
  const key = cacheKey(CACHE_PREFIX.JOB_PROGRESS, jobId);
  return cacheGetJson(key);
}

export async function rateLimitCheck(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const redis = await ensureRedis();
    const key = cacheKey(CACHE_PREFIX.RATELIMIT, bucket);
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
    };
  } catch {
    resetRedisClient();
    return { allowed: true, remaining: limit };
  }
}

export async function setWorkerHeartbeat(workerId: string): Promise<void> {
  const key = cacheKey(CACHE_PREFIX.WORKER_HEARTBEAT, workerId);
  await cacheSetJson(key, { at: new Date().toISOString() }, 120);
}

export async function hasActiveWorker(): Promise<boolean> {
  try {
    const redis = await ensureRedis();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${CACHE_PREFIX.WORKER_HEARTBEAT}:*`,
        'COUNT',
        10,
      );
      cursor = next;
      if (keys.length > 0) return true;
    } while (cursor !== '0');
    return false;
  } catch {
    resetRedisClient();
    return false;
  }
}

export async function cacheStats(): Promise<{
  connected: boolean;
  db: number;
  keysEstimate: number;
  prefixes: { prefix: string; count: number }[];
}> {
  try {
    const redis = await ensureRedis();
    const info = await redis.info('keyspace');
    const dbMatch = info.match(/db1:keys=(\d+)/);

    const prefixCounts = new Map<string, number>();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'sv:*', 'COUNT', 200);
      cursor = next;
      for (const key of keys) {
        const parts = key.split(':');
        const prefix = parts.length >= 2 ? `${parts[0]}:${parts[1]}` : key;
        prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
      }
    } while (cursor !== '0');

    const prefixes = [...prefixCounts.entries()]
      .map(([prefix, count]) => ({ prefix, count }))
      .sort((a, b) => b.count - a.count);

    return {
      connected: redis.status === 'ready',
      db: 1,
      keysEstimate: dbMatch ? parseInt(dbMatch[1], 10) : 0,
      prefixes,
    };
  } catch {
    resetRedisClient();
    return { connected: false, db: 1, keysEstimate: 0, prefixes: [] };
  }
}

export async function cacheListKeys(
  pattern: string,
  limit = 100,
): Promise<{ key: string; ttl: number }[]> {
  try {
    const redis = await ensureRedis();
    const safePattern = pattern.includes('*') ? pattern : `${pattern}*`;
    const out: { key: string; ttl: number }[] = [];
    let cursor = '0';

    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', safePattern, 'COUNT', 100);
      cursor = next;
      for (const key of keys) {
        if (out.length >= limit) return out;
        const ttl = await redis.ttl(key);
        out.push({ key, ttl });
      }
    } while (cursor !== '0' && out.length < limit);

    return out;
  } catch {
    resetRedisClient();
    return [];
  }
}

export async function cacheClearPrefix(prefix: string): Promise<number> {
  const pattern = prefix.endsWith('*') ? prefix : `${prefix}*`;
  return cacheDel(pattern);
}
