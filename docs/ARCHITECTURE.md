# Stock Verifier v2 — Architecture

## Overview

API-first monorepo replacing PHP page scripts with:

- **Fastify API** — auth, screener jobs, verify, admin
- **BullMQ workers** — chunked screener scans with Redis progress + WebSocket
- **React SPA** — screener, verify, dashboard
- **PostgreSQL** (`shared_postgres`) — users, universes, jobs, verification history
- **Redis** (`shared_redis`, DB 1) — market data cache, rate limits, job pub/sub

## Drawbacks removed vs PHP

| PHP issue | v2 solution |
|-----------|-------------|
| File/JSON stores | PostgreSQL + Prisma migrations |
| File/SQLite cache | Redis with namespaced TTL keys |
| CLI background jobs | BullMQ with retry and progress |
| Monolithic PHP pages | React + REST API |
| Session auth | JWT + RBAC in database |
| No horizontal scale | Stateless API + worker replicas |

## Data flow — screener

```
React → POST /api/v1/screener/run
     → API creates Job row (PostgreSQL)
     → if background: BullMQ enqueue
     → Worker chunks symbols → @sv/core runScreener
     → progress → Redis pub/sub → WebSocket
     → result → Job.result JSON
```

## Redis key namespace

Prefix `sv:` — see `packages/shared/src/constants.ts` (`CACHE_PREFIX`, `CACHE_TTL`).

## Phase roadmap

1. **Done (MVP)** — Auth, screener, verify, worker, Docker on `shared_network`
2. **Done** — Yahoo + Screener.in adapters (`@sv/data-adapters`), live verify/screener with Redis cache
3. **Done** — Full `CfaValuationEngine` port, golden parity tests, admin CSV uploads
4. **Done** — Watchlists, verification history, swing positions + PHP JSON migration
5. **Done** — `@sv/swing` engine (E1–E11, GC9, scanner), Yahoo daily chart TA, BullMQ swing scan
6. **Next** — Swing auto-radar, exit rules on positions, Nifty intraday modules
