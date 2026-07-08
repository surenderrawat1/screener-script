# Redis & Cache

Redis database **1** is reserved for Script Screener (`REDIS_URL=redis://host:6379/1`).

All keys use the `sv:` prefix. Definitions: `packages/shared/src/constants.ts`.

**Policy:** Redis is a hot cache only — reference data lives in PostgreSQL. TTL defaults are in `config/data-policy.yaml`. See [Data Rules](DATA-RULES.md).

---

## Key namespaces

| Prefix | Example key | Content | TTL (seconds) |
|--------|-------------|---------|---------------|
| `sv:stock` | `sv:stock:TCS` | Yahoo OHLC + computed fields | 604800 (7d) |
| `sv:verify` | `sv:verify:TCS` | Cached verify result | 604800 (7d) |
| `sv:yahoo` | `sv:yahoo:...` | Raw Yahoo responses | 604800 (7d) |
| `sv:screener:row` | `sv:screener:row:TCS` | Screener.in row data | 3600 (1h) |
| `sv:screener:table` | `sv:screener:table:...` | Bulk screener table | 86400 (24h) |
| `sv:ta` | `sv:ta:TCS` | Computed TA indicators | 86400 (24h) |
| `sv:universe` | `sv:universe:nifty50` | Symbol array for universe | 86400 (24h) |
| `sv:index` | `sv:index:nifty50` | Index sync metadata | 2592000 (30d) |
| `sv:alias` | `sv:alias:...` | Symbol alias map | — |
| `sv:ratelimit` | `sv:ratelimit:...` | Rate limit counters | varies |
| `sv:job:progress` | `sv:job:progress:{jobId}` | Job progress JSON | 3600 (1h) |
| `sv:worker:heartbeat` | `sv:worker:heartbeat` | Worker liveness timestamp | short |
| `sv:swing:auto` | `sv:swing:auto` | Latest auto-radar snapshot | 7200 (2h) |
| `sv:regime` | `sv:regime:nifty` | Live market regime | 900 (15m) |
| `sv:morning` | `sv:morning:bundle:system`, `sv:morning:etf` | Morning briefing and ETF panel | 60 / 600 |

Helper functions in `@sv/cache`:

- `cacheKey(prefix, ...parts)` — build key
- `cacheGetJson` / `cacheSetJson` — typed JSON get/set with TTL
- `setJobProgress` / `getJobProgress` — job tracking
- `setWorkerHeartbeat` / `hasActiveWorker` — health checks
- `cacheStats()` — admin memory/key summary

---

## Universe resolution

`resolveUniverseSymbols(universeKey, maxScan)` in `@sv/data-adapters`:

```
1. Redis sv:universe:{key}     ← fastest, populated by index sync
2. PostgreSQL universe_symbols   ← joined to universes table
3. PostgreSQL index_constituents ← where effective_to IS NULL
4. PostgreSQL nse_equity_list    ← only for total_nse
5. DEV_FALLBACK (10 symbols)     ← non-production only, nifty50 sample
```

In **production**, empty universes return `[]` — no silent fallback. Run `pnpm sync:indices` before scanning.

---

## Index sync cache

After `syncIndexUniverse()`:

**`sv:index:{indexKey}`** — metadata:

```json
{
  "indexKey": "nifty50",
  "count": 50,
  "sourceFile": "/path/to/ind_nifty50list.csv",
  "importedAt": "2026-07-02T...",
  "added": 0,
  "removed": 0
}
```

**`sv:universe:{indexKey}`** — sorted symbol array:

```json
["ADANIENT", "ADANIPORTS", "...", "WIPRO"]
```

---

## Market regime cache

`currentMarketRegime()` fetches NIFTYBEES daily bars, runs `regimeFromBars()`, caches result:

```json
{
  "key": "bull",
  "label": "Bull",
  "bull": true,
  "bear": false,
  "sideways": false,
  "pct_52w_min": 32,
  "pct_52w_max": 68,
  "blocks_strict_enter": false,
  "proxy": "NIFTYBEES"
}
```

Used by swing scanner and auto-radar to adjust 52-week bands and entry gates.

---

## Swing auto snapshot

Redis holds the **live** auto-radar snapshot. PostgreSQL `swing_auto_snapshots` archives each save for durability.

Read path: `getSwingAutoSnapshotDurable()` — Redis first, DB fallback.

---

## Job progress pub/sub

When a background job runs:

1. Worker writes progress to `sv:job:progress:{jobId}`
2. Worker publishes to Redis channel `job:{jobId}`
3. API WebSocket `/ws/jobs/:id` subscribes and forwards to browser

---

## Admin cache inspection

`GET /api/v1/admin/cache/stats` returns Redis memory usage and approximate key counts.

Future Phase 9: cache admin UI to list/clear keys by prefix.

---

## Local development notes

**`ENOTFOUND shared_redis`** — occurs when `.env` is not loaded before Redis client init. Fixed by `load-env.ts` as first import in API/worker. Local dev should use:

```
REDIS_URL=redis://127.0.0.1:6379/1
```

Not `redis://shared_redis:6379/1` unless running inside Docker on `shared_network`.

---

## Clearing cache

```bash
# Clear all Script Screener keys (DB 1)
redis-cli -n 1 KEYS 'sv:*' | xargs redis-cli -n 1 DEL

# Or flush entire DB 1 (affects only SV if DB 1 is dedicated)
redis-cli -n 1 FLUSHDB
```

After flush, universes reload from PostgreSQL on next scan. Index/universe Redis caches repopulate on next `sync:indices` or the daily 6 AM sync job — see [Data Rules](DATA-RULES.md).
