# Stock Verifier v2

Modern rewrite of the PHP stock-verifier using **Node.js**, **React**, **Redis**, and **PostgreSQL**.

## Infrastructure

| Service    | Container         | Network          |
|-----------|-------------------|------------------|
| PostgreSQL | `shared_postgres` | `shared_network` |
| Redis      | `shared_redis`    | `shared_network` |

Connection strings (from app containers on `shared_network`):

```
DATABASE_URL=postgresql://platform:platform@shared_postgres:5432/stock_verifier
REDIS_URL=redis://shared_redis:6379/1
```

## Quick start

### 1. Create database (once)

```bash
docker exec shared_postgres psql -U platform -d market_research -c "CREATE DATABASE stock_verifier;"
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit secrets for production
```

### 3. Install & migrate

```bash
pnpm install
pnpm db:generate
pnpm db:push
pnpm db:seed
```

### 4. Run locally (host → shared containers via localhost ports)

For local dev when Postgres/Redis are exposed on host ports:

```bash
export DATABASE_URL=postgresql://platform:platform@localhost:5432/stock_verifier
export REDIS_URL=redis://localhost:6379/1
pnpm dev          # API + Web
pnpm dev:worker   # Background screener worker (separate terminal)
```

### 5. Run with Docker

```bash
docker compose up --build
```

- Web: http://localhost:5173  
- API: http://localhost:3100  
- Default login: `admin@example.com` / `admin123`

## Monorepo layout

```
apps/api       Fastify REST + WebSocket
apps/worker    BullMQ screener consumer
apps/web       React SPA
packages/core  CFA valuation & screener logic
packages/db    Prisma + PostgreSQL
packages/cache Redis client
packages/jobs  BullMQ queue definitions
packages/shared Types, Zod schemas, constants
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness |
| GET | `/health/ready` | Postgres + Redis + worker |
| POST | `/api/v1/auth/login` | JWT login |
| GET | `/api/v1/universes` | List universes |
| POST | `/api/v1/screener/run` | Run screener (sync or background) |
| GET | `/api/v1/screener/jobs/:id` | Job status |
| POST | `/api/v1/verify/auto` | One-click CFA verify |
| WS | `/ws/jobs/:id` | Job progress stream |

## Migration from PHP

See [docs/MIGRATION.md](docs/MIGRATION.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Phase 2 — Live data (done)

Verify and screener now fetch from **Yahoo Finance** + **Screener.in** via `@sv/data-adapters`, with Redis caching (7d stock, 24h screener ratios). Falls back to sample metrics if fetch fails.

## Tests

```bash
pnpm --filter @sv/core test
```

## Disclaimer

Educational research tool only — not SEBI-registered investment advice.
