import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
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

/**
 * Batch JSON GET via Redis MGET (one round trip for many keys).
 * Missing / unparseable entries are null — same semantics as cacheGetJson.
 */
export async function cacheGetJsonMany<T>(keys: string[]): Promise<Array<T | null>> {
  if (keys.length === 0) return [];
  try {
    const redis = await ensureRedis();
    const raw = await redis.mget(...keys);
    return raw.map((item) => {
      if (item == null) return null;
      try {
        return JSON.parse(item) as T;
      } catch {
        return null;
      }
    });
  } catch {
    resetRedisClient();
    return keys.map(() => null);
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

/** Acquire a short Redis lease. Returns null when held or Redis is unavailable. */
export async function acquireCacheLock(key: string, ttlSeconds: number): Promise<string | null> {
  try {
    const redis = await ensureRedis();
    const token = randomUUID();
    const result = await redis.set(key, token, 'EX', Math.max(1, ttlSeconds), 'NX');
    return result === 'OK' ? token : null;
  } catch {
    resetRedisClient();
    return null;
  }
}

/** Release only the lease owned by token; never delete another worker's lock. */
export async function releaseCacheLock(key: string, token: string): Promise<void> {
  try {
    const redis = await ensureRedis();
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      token,
    );
  } catch {
    resetRedisClient();
  }
}

/** Extend TTL only when this process still owns the lease. */
export async function renewCacheLock(
  key: string,
  token: string,
  ttlSeconds: number,
): Promise<boolean> {
  try {
    const redis = await ensureRedis();
    const result = await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2]) else return 0 end",
      1,
      key,
      token,
      String(Math.max(1, ttlSeconds)),
    );
    return result === 'OK';
  } catch {
    resetRedisClient();
    return false;
  }
}

const WORKER_LEADER_KEY = 'sv:worker:leader';
/** Lease longer than heartbeat interval so a busy tick cannot lose leadership mid-work. */
export const WORKER_LEADER_TTL_SEC = 90;

/**
 * Single-leader gate for scheduled worker ticks (auto scan, paper, daily sync).
 * Fail-open when Redis is unavailable so local single-worker still runs.
 * Returns true when this workerId holds (or just acquired) the lease.
 */
export async function tryHoldWorkerLeader(
  workerId: string,
  ttlSeconds = WORKER_LEADER_TTL_SEC,
): Promise<boolean> {
  const id = String(workerId || '').trim();
  if (!id) return true;
  try {
    const redis = await ensureRedis();
    const ttl = Math.max(1, ttlSeconds);
    const current = await redis.get(WORKER_LEADER_KEY);
    if (current === id) {
      await redis.expire(WORKER_LEADER_KEY, ttl);
      return true;
    }
    if (current) return false;
    const result = await redis.set(WORKER_LEADER_KEY, id, 'EX', ttl, 'NX');
    return result === 'OK';
  } catch {
    resetRedisClient();
    return true;
  }
}

export async function releaseWorkerLeader(workerId: string): Promise<void> {
  const id = String(workerId || '').trim();
  if (!id) return;
  await releaseCacheLock(WORKER_LEADER_KEY, id);
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
  const intradayKey = sym.replace(/[^A-Z0-9]/g, '_');

  const keys = [
    cacheKey(CACHE_PREFIX.STOCK, sym),
    cacheKey(CACHE_PREFIX.VERIFY, sym),
    cacheKey(CACHE_PREFIX.SCREENER_TABLE, slug),
    cacheKey(CACHE_PREFIX.SCREENER_TABLE, `annual:${slug}`),
    cacheKey(CACHE_PREFIX.SCREENER_TABLE, `profile:consolidated:${slug}`),
    cacheKey(CACHE_PREFIX.SCREENER_TABLE, `profile:standalone:${slug}`),
    cacheKey(CACHE_PREFIX.YAHOO, `${sym}.NS`),
    cacheKey(CACHE_PREFIX.YAHOO, `${sym}.BO`),
    cacheKey(CACHE_PREFIX.YAHOO, `quote:${sym}.NS`),
    cacheKey(CACHE_PREFIX.YAHOO, `quote:${sym}.BO`),
    cacheKey(CACHE_PREFIX.TA, `bars:1h:${sym}`),
    cacheKey(CACHE_PREFIX.TA, `bars:${sym}:1y`),
    cacheKey(CACHE_PREFIX.TA, `bars:${sym}:2y`),
  ];
  const patterns = [
    cacheKey(CACHE_PREFIX.SCREENER_ROW, `*:${sym}`),
    cacheKey(CACHE_PREFIX.TA, `bars:${sym}*`),
    cacheKey(CACHE_PREFIX.TA, `bars:1h:${sym}*`),
    cacheKey(CACHE_PREFIX.TA, `intraday:${intradayKey}:*`),
    cacheKey(CACHE_PREFIX.INTRADAY, `state:${slug}:*`),
  ];

  let deleted = 0;
  for (const key of keys) {
    try {
      if (await cacheDeleteKey(key)) deleted += 1;
    } catch {
      // Redis unavailable — continue best-effort
    }
  }
  for (const pattern of patterns) {
    try {
      deleted += await cacheDel(pattern);
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

export async function setWorkerHeartbeat(
  workerId: string,
  meta: { leader?: boolean } = {},
): Promise<void> {
  const key = cacheKey(CACHE_PREFIX.WORKER_HEARTBEAT, workerId);
  await cacheSetJson(
    key,
    {
      at: new Date().toISOString(),
      ...(meta.leader != null ? { leader: meta.leader } : {}),
    },
    120,
  );
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

export async function cachePreviewKey(
  key: string,
  maxChars = 12000,
): Promise<{
  key: string;
  exists: boolean;
  ttl: number;
  type: string;
  bytes: number;
  truncated: boolean;
  value: unknown;
}> {
  try {
    const redis = await ensureRedis();
    const [type, ttl, raw] = await Promise.all([redis.type(key), redis.ttl(key), redis.get(key)]);
    if (raw == null) {
      return { key, exists: false, ttl, type, bytes: 0, truncated: false, value: null };
    }

    const bytes = Buffer.byteLength(raw, 'utf8');
    const truncated = raw.length > maxChars;
    const text = truncated ? raw.slice(0, maxChars) : raw;
    let value: unknown = text;
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }

    return { key, exists: true, ttl, type, bytes, truncated, value };
  } catch {
    resetRedisClient();
    return { key, exists: false, ttl: -2, type: 'unknown', bytes: 0, truncated: false, value: null };
  }
}

export async function cacheClearPrefix(prefix: string): Promise<number> {
  const pattern = prefix.endsWith('*') ? prefix : `${prefix}*`;
  return cacheDel(pattern);
}
