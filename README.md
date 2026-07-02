# Script Screener

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
packages/core          CFA valuation & screener logic
packages/swing         Swing TA rules engine (E1–E11, GC9)
packages/data-adapters Yahoo + Screener.in + swing charts
packages/db            Prisma + PostgreSQL
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
| GET | `/api/v1/admin/uploads/stats` | NSE + promoter row counts |
| POST | `/api/v1/admin/uploads/nse-equity` | Upload NSE equity CSV |
| POST | `/api/v1/admin/uploads/promoter-holding` | Upload promoter holding CSV |
| GET | `/api/v1/watchlist` | User watchlist + summary |
| PUT | `/api/v1/watchlist/items` | Add/update watchlist symbol |
| GET | `/api/v1/verify/history` | Recent verification runs |
| GET | `/api/v1/swing/positions` | Swing positions (open/closed) |
| POST | `/api/v1/swing/scan` | Run swing TA scanner |
| POST | `/api/v1/swing/evaluate` | Single-symbol swing entry eval |
| WS | `/ws/jobs/:id` | Job progress stream |

## Migration from PHP

See [docs/MIGRATION.md](docs/MIGRATION.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Phase 2 — Live data (done)

Verify and screener now fetch from **Yahoo Finance** + **Screener.in** via `@sv/data-adapters`, with Redis caching (7d stock, 24h screener ratios). Falls back to sample metrics if fetch fails.

## Phase 3 — CFA engine parity + admin uploads (done)

- Full `CfaValuationEngine` port in `@sv/core` (`estimate()` / `analyze()` — DCF, P/B, EV/EBITDA, Graham floor)
- Golden parity tests vs PHP `validate-logic.php` (TCS MOS, banking P/B, ONGC Graham floor, MOS formula)
- Admin CSV uploads: NSE `EQUITY_L.csv` → `total_nse` universe; promoter holding CSV → screener overlay
- Web **Admin** page at `/admin` (requires login with `MANAGE_CACHE` permission)

## Phase 4 — User data & PHP migration (done)

- **Watchlists** — thesis/review meta in PostgreSQL; auto-snapshot on verify
- **Verification history** — persisted runs + recent list on Verify page
- **Swing positions** — open/closed trades from PHP `swing_positions.json`
- **Migration CLI:** `pnpm migrate:php -- --user admin@example.com`

## Phase 5 — Swing scanner engine (done)

- New **`@sv/swing`** package — GC9/DC9, dynamic signals, E1–E11 entry rules, ranker, universe scanner
- Yahoo **daily OHLC** fetch (2y) with Redis TA cache
- API: `POST /api/v1/swing/scan`, `POST /api/v1/swing/evaluate`
- BullMQ queue `sv-swing-scan` (worker handles alongside screener)
- Web **Swing** page (`/swing`) — scan Nifty universe, SETUP+ / GC9 filters
- Parity tests vs PHP `testSwingGc9Entry`

## Phase 6 — Auto-radar, exit rules, intraday (done)

- **`evaluateExit` (X1–X9)** — stop/trail/breakeven, profit target, trend break, RSI, time stop, PA exit, hourly EMA
- **`SwingAutoDecision` + `SwingAutoScreener`** — tier categorization, position actions, heat gate, overlay held symbols
- **`@sv/intraday`** — 13 entry presets, preflight checklist, live playbook (15m directional MVP)
- API: `GET /api/v1/swing/auto/state`, `GET /api/v1/swing/positions?live=1`, `GET /api/v1/intraday/nifty/state`
- Web: **Auto Radar** (`/swing/auto`), **Intraday** (`/intraday`)
- Parity: `parity-exit.test.ts`, `parity-auto.test.ts`, `@sv/intraday` parity suite

## Phase 7 — Live Nifty feed, auto-scan scheduler, incremental scan (done)

- **Live Nifty intraday** — Yahoo 5m/15m charts (`fetchNiftyIntradayCharts`), `Nifty15mDirection`, MTF confluence, trade plan, signal quality grading
- **Redis swing auto snapshot** — `getSwingAutoSnapshot` / `saveSwingAutoSnapshot` with tier summary
- **Incremental scan** — `shouldRunFullScan`, `buildRefreshSet`, `mergeHits` (full every 30m, rotate batch 30)
- **Auto-scan scheduler** — worker tick every 60s, `shouldStartAutoScan` (300s interval), background jobs via BullMQ
- API: `POST /api/v1/swing/auto/scan`, `GET /api/v1/intraday/nifty/state?refresh=1&interval=5m`
- Parity: `parity-incremental.test.ts`, `parity-direction.test.ts`

## Tests

```bash
pnpm --filter @sv/core test
pnpm --filter @sv/swing test
pnpm --filter @sv/intraday test
```

## Disclaimer

Educational research tool only — not SEBI-registered investment advice.
