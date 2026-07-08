# Architecture

## Overview

Script Screener is an **API-first monorepo** that replaces PHP page scripts with:

| Layer | Technology | Responsibility |
|-------|------------|----------------|
| Web | React + Vite | SPA for screener, verify, swing, admin |
| API | Fastify | REST, JWT auth, WebSocket job progress |
| Worker | BullMQ | Background screener/swing scans, auto-radar tick |
| Data | PostgreSQL | Users, jobs, universes, positions, history |
| Cache | Redis (DB 1) | Market data, TA, universes, job progress |
| Logic | TypeScript packages | CFA engine, swing rules, intraday, adapters |

```
┌─────────────┐     REST/WS      ┌─────────────┐
│  React SPA  │ ◄──────────────► │  Fastify    │
│  apps/web   │                  │  apps/api   │
└─────────────┘                  └──────┬──────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
             ┌──────────┐     ┌──────────┐     ┌──────────┐
             │PostgreSQL│     │  Redis   │     │  BullMQ  │
             │  @sv/db  │     │ @sv/cache│     │ @sv/jobs │
             └──────────┘     └──────────┘     └────┬─────┘
                                                    │
                                                    ▼
                                             ┌──────────┐
                                             │  Worker  │
                                             │apps/worker│
                                             └──────────┘
```

---

## Improvements over PHP stock-verifier

| PHP issue | Script Screener solution |
|-----------|--------------------------|
| File/JSON stores | PostgreSQL + Prisma migrations |
| File/SQLite cache | Redis with namespaced TTL keys (`sv:*`) |
| CLI background jobs | BullMQ with retry, progress, WebSocket |
| Monolithic PHP pages | React SPA + REST API |
| Session auth | JWT + RBAC in database |
| No horizontal scale | Stateless API + worker replicas |
| Static regime stub | Live NIFTYBEES regime with Redis cache |
| Index CSV manual copy | `sync:indices` CLI + Admin sync/upload + daily 6 AM job |
| Hard-coded TTLs | `config/data-policy.yaml` + Settings overrides — [Data Rules](DATA-RULES.md) |

---

## Data flows

For the current high-accuracy source, cache, data-quality, and CFA calculation contract, see
[High Accuracy Architecture & CFA Calculation Rules](HIGH-ACCURACY-ARCHITECTURE.md).

### Screener run

```
User → POST /api/v1/screener/run
     → API resolves universe symbols (@sv/data-adapters)
     → Creates Job row (PostgreSQL, status=pending)
     → If background: enqueue BullMQ sv-screener
     → Worker: runLiveScreener per symbol (@sv/core + adapters)
     → Progress → Redis sv:job:progress + pub/sub job:{id}
     → WebSocket /ws/jobs/:id streams to browser
     → Result stored in Job.result JSON
```

Background threshold: **400** symbols (80 with TA-active filters).

### CFA verify

```
User → POST /api/v1/verify/auto
     → fetchStockData (Yahoo OHLC + Screener.in ratios)
     → Redis cache sv:stock:{symbol}, sv:screener:row:{symbol}
     → CfaValuationEngine.analyze() (@sv/core)
     → Persist VerificationRun
     → Optional watchlist meta update
```

### Swing scan

```
User → POST /api/v1/swing/scan
     → resolveUniverseSymbols
     → For each symbol: fetch daily bars (2y Yahoo) → compute TA
     → evaluateEntry E1–E11 + GC9/DC9 (@sv/swing)
     → Rank hits, return or background job (≥ 25 symbols)
```

### Auto-radar (scheduled)

```
Worker tick (every 60s) → shouldStartAutoScan (300s interval)
     → buildAutoScanPlan: full vs incremental scan
     → currentMarketRegime() via NIFTYBEES daily bars
     → executeAutoScanPlan → mergeHits
     → saveSwingAutoSnapshot (Redis) + archiveSwingAutoSnapshot (PostgreSQL)
```

Incremental logic: full scan every 30 minutes; between full scans, rotate batch of 30 symbols for refresh.

### Index sync

```
pnpm sync:indices OR Admin POST /indices/sync
     → parseIndexCsvContent (Market Watch or standard CSV)
     → Upsert IndexConstituent (effective dating for adds/removes)
     → Replace UniverseSymbol rows for universe key
     → Cache sv:index:{key} metadata + sv:universe:{key} symbol list
```

---

## Package dependency graph

```
apps/api ──────► @sv/data-adapters ──► @sv/swing, @sv/core, @sv/db, @sv/cache
apps/worker ───► @sv/data-adapters
apps/web       (HTTP only, no package deps on backend)

@sv/data-adapters ──► @sv/swing, @sv/core, @sv/db, @sv/cache, @sv/jobs
@sv/intraday ────────► @sv/swing
@sv/swing ───────────► @sv/cache, @sv/shared
@sv/core ────────────► @sv/shared
@sv/jobs ────────────► @sv/cache, @sv/shared
@sv/db ──────────────► @sv/shared, Prisma
@sv/cache ───────────► @sv/shared, ioredis
```

Business logic lives in `packages/*`. Apps are thin HTTP/worker shells.

---

## Authentication model

1. `POST /auth/login` validates bcrypt password hash in `users` table
2. API signs JWT with `{ sub, email, role }`, 15-minute expiry
3. `authPreHandler` verifies JWT on protected routes
4. `requirePermission()` checks role against `ROLE_PERMISSIONS`
5. Optional `SV_ADMIN_KEY` header bypasses JWT for automation

---

## Job system

| Queue | Job type | Worker handler |
|-------|----------|----------------|
| `sv-screener` | `screener` | `runLiveScreener` |
| `sv-swing-scan` | `swing_scan` | `runSwingScan` or `executeAutoScanPlan` |

Job lifecycle: `pending` → `running` → `done` | `failed`

Progress JSON shape: `{ phase, total, processed, passed }`

Worker heartbeat: Redis key `sv:worker:heartbeat` — checked by `/health/ready`.

---

## External data sources

| Source | Used for | Cache TTL |
|--------|----------|-----------|
| Yahoo Finance | OHLC, intraday Nifty | 7d stock/raw, 5m intraday chart |
| Screener.in | Ratios, annual financials, profile/expenditures | 24h table/profile, 1h analyzed row |
| NSE index CSVs | Universe constituents | 30d index metadata, 24h universe list |
| Morning routine | Assembled briefing, ETF panel | 1m bundle, 10m ETF panel |
| Uploaded CSVs | total_nse, promoter holdings | Until re-upload |

---

## Environment loading

ESM import order matters. Both `apps/api` and `apps/worker` import `./load-env.js` **first** so `dotenv` runs before `@sv/cache` reads `REDIS_URL`.

Default Redis fallback when unset: `redis://127.0.0.1:6379/1` (not `shared_redis`).

---

## Docker deployment

Three services on external `shared_network`:

- **sv-api** — exposes 3100, runs migrations on start
- **sv-worker** — no exposed ports
- **sv-web** — Nginx on 5173 serving static build

See [Operations](OPERATIONS.md) for details.

---

## Testing strategy

Parity tests compare TypeScript output against PHP `validate-logic.php` fixtures:

| Package | Tests | PHP reference |
|---------|-------|---------------|
| `@sv/core` | DCF, MOS, P/B, Graham | `validate-logic.php` |
| `@sv/swing` | GC9, exit, auto, incremental, regime | `testSwingGc9Entry`, exit rules |
| `@sv/intraday` | Direction, presets | PHP intraday modules |
| `@sv/shared` | Index CSV parsing | NSE CSV formats |

Run: `pnpm test` or per-package `pnpm --filter @sv/swing test`.
