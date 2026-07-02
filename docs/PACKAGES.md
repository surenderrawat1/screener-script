# Packages

pnpm workspace monorepo. Each package builds with `tsc` to `dist/`.

---

## Apps

### `apps/api` (`@sv/api`)

Fastify HTTP server.

| File | Purpose |
|------|---------|
| `src/load-env.ts` | dotenv — **must be first import** |
| `src/server.ts` | Route registration, plugins (JWT, CORS, multipart, WebSocket) |
| `src/services/*.ts` | Thin service layer per domain |
| `src/lib/auth.ts` | JWT user, permission checks |

Port: `API_PORT` (default 3100).

### `apps/web` (`@sv/web`)

React 19 SPA with React Router.

| Path | Purpose |
|------|---------|
| `src/pages/` | One page component per route |
| `src/components/PageLayout.tsx` | Shared `Page`, `PageHeader`, `EmptyState` |
| `src/brand.ts` | `APP_NAME = 'Script Screener'` |
| `src/api.ts` | `api()` fetch helper with JWT |
| `src/auth.tsx` | Auth context provider |

Dev server: Vite on port 5173, proxies API requests.

### `apps/worker` (`@sv/worker`)

BullMQ consumer process.

| Responsibility |
|----------------|
| Process `sv-screener` jobs |
| Process `sv-swing-scan` jobs (manual + auto-radar) |
| Auto-scan scheduler tick every 60s |
| Worker heartbeat to Redis |

**Must run separately** from `pnpm dev` for background jobs and auto-radar.

---

## Packages

### `@sv/shared`

Shared types, Zod schemas, constants.

| Module | Contents |
|--------|----------|
| `constants.ts` | Roles, permissions, cache prefixes/TTLs, presets |
| `indices.ts` | `INDEX_DEFINITIONS`, filename guessing |
| `index-csv.ts` | `parseIndexCsvContent` for NSE CSV formats |
| `schemas.ts` | Request validation schemas |

Tests: `index-csv.test.ts`

### `@sv/db`

Prisma client + database CLI.

| Export | Purpose |
|--------|---------|
| `prisma` | Singleton Prisma client |
| `UserRole`, `JobStatus`, `JobType` | Enums |

Scripts: `seed`, `migrate:php`, `push`, `generate`

### `@sv/cache`

Redis (ioredis) wrapper.

| Function | Purpose |
|----------|---------|
| `getRedis()` | Connection singleton |
| `cacheGetJson` / `cacheSetJson` | Typed cache |
| `setJobProgress` | Job progress + pub/sub |
| `setWorkerHeartbeat` | Liveness for health check |
| `cacheStats` | Admin stats |

### `@sv/jobs`

BullMQ queue definitions.

| Queue | Name |
|-------|------|
| Screener | `sv-screener` |
| Swing scan | `sv-swing-scan` |

Helpers: `shouldRunInBackground`, `shouldRunSwingInBackground`, `enqueueScreenerJob`, `enqueueSwingScanJob`

### `@sv/core`

CFA valuation engine — port of PHP `CfaValuationEngine`.

| Module | Purpose |
|--------|---------|
| `valuation.ts` | DCF, P/B, EV/EBITDA, Graham floor |
| `screener.ts` | `runScreener` filter pipeline |
| `types.ts` | Metric and result types |

Tests: `parity.test.ts`, `valuation.test.ts` (13 tests)

### `@sv/swing`

Swing technical analysis rules engine.

| Module | Purpose |
|--------|---------|
| `evaluate-entry.ts` | Rules E1–E11 |
| `evaluate-exit.ts` | Rules X1–X9 |
| `gc9-dc9.ts` | Golden/death cross state machine |
| `scanner.ts` | Universe scan + ranker |
| `auto-screener.ts` | Auto-radar tier categorization |
| `auto-decision.ts` | Position actions, heat gate |
| `incremental-scan.ts` | Full vs incremental scan logic |
| `market-regime.ts` | `regimeFromBars`, `defaultRegime` |
| `swing-auto-snapshot.ts` | Redis snapshot save/load |

Tests: 33 tests across 5 parity files

### `@sv/intraday`

Nifty intraday analysis.

| Module | Purpose |
|--------|---------|
| `direction.ts` | 15m/5m direction analysis |
| `presets.ts` | 13 entry presets |
| `playbook.ts` | Trade plan, MTF confluence |
| `signal-quality.ts` | Grade signal quality |

Tests: 17 tests

### `@sv/data-adapters`

External data fetching and orchestration.

| Module | Purpose |
|--------|---------|
| `yahoo.ts` | Yahoo Finance OHLC |
| `screener-in.ts` | Screener.in scraping |
| `stock-data-fetcher.ts` | Combined stock context |
| `swing-chart.ts` | Daily bars + TA for swing |
| `intraday-chart.ts` | Nifty 5m/15m charts |
| `swing-scan.ts` | Run swing scan over symbols |
| `auto-swing-scan.ts` | Auto-radar execution + durable snapshot |
| `auto-swing-scheduler.ts` | `shouldStartAutoScan`, `buildAutoScanPlan` |
| `universe.ts` | `resolveUniverseSymbols` |
| `index-sync.ts` | Index CSV → DB + Redis |
| `market-regime.ts` | `currentMarketRegime()` |
| `screener-run.ts` | Live screener orchestration |
| `sync-indices-cli.ts` | CLI entry for `pnpm sync:indices` |

---

## Dependency rules

1. **No app-to-app imports** — apps only import packages
2. **No worker → api imports** — shared logic lives in `@sv/data-adapters`
3. **`@sv/db` does not import `@sv/data-adapters`** — avoids circular deps; index CLI is in data-adapters
4. **Business logic stays in packages** — apps are transport layers

---

## Adding a new feature

1. Add domain logic to the appropriate `packages/*` module
2. Add tests in the same package (`*.test.ts`)
3. Expose via `packages/*/src/index.ts` exports
4. Wire thin handler in `apps/api/src/services/`
5. Register route in `server.ts`
6. Add page in `apps/web/src/pages/` if user-facing
7. Update [API.md](API.md) and [WEB-UI.md](WEB-UI.md)

---

## Build order

`pnpm build` runs recursively. Packages with no inter-package build deps compile in parallel. Apps depend on compiled package `dist/` output.

Typecheck only: `pnpm typecheck`
