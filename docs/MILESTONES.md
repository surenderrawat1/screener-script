# Development Milestones

This document tracks **Script Screener** (`stock-verifier-v2`) development from PHP rewrite through production readiness. Each milestone has a goal, deliverables, acceptance criteria, and key artifacts.

For high-level “what’s next,” see [Roadmap](ROADMAP.md). For setup and operations, see [Getting Started](GETTING-STARTED.md).

---

## Progress overview

| Milestone | Name | Status | Tests added |
|-----------|------|--------|-------------|
| M1 | MVP foundation | ✅ Complete | — |
| M2 | Live data adapters | ✅ Complete | — |
| M3 | CFA engine parity | ✅ Complete | 13 (`@sv/core`) |
| M4 | User data & PHP migration | ✅ Complete | — |
| M5 | Swing scanner engine | ✅ Complete | 16 (`@sv/swing`) |
| M6 | Auto-radar, exit, intraday | ✅ Complete | 26 (`@sv/swing` + `@sv/intraday`) |
| M7 | Live Nifty & auto-scan scheduler | ✅ Complete | 12 |
| M8 | Data foundation | ✅ Complete | 7 |
| M9 | Cache admin & job UX | 🟡 In progress | 6 (`@sv/shared` config) |
| M10 | Morning dashboard & LTG auto | 🔲 Planned | — |
| M11 | Strategy builder | 🔲 Planned | — |
| M12 | Backtesting & parity expansion | 🔲 Planned | — |
| M13 | Production hardening | 🔲 Planned | — |

**Current baseline:** 77 tests passing · Phases 1–8 shipped · **M9 in progress** (config, cache admin, daily sync DR-C)

---

## Milestone template

Each completed/planned milestone follows this structure:

- **Goal** — why the milestone exists
- **Deliverables** — what ships
- **Acceptance criteria** — how to verify done
- **Key artifacts** — code, API, UI, docs
- **Depends on** — prior milestones

---

## M1 — MVP foundation ✅

**Goal:** Replace PHP monolith with a runnable API-first stack: auth, screener, verify, worker, and basic UI.

### Deliverables

- [x] pnpm monorepo (`apps/api`, `apps/web`, `apps/worker`, `packages/*`)
- [x] PostgreSQL schema via Prisma (`users`, `jobs`, `universes`)
- [x] JWT login + RBAC (`admin`, `analyst`, `viewer`)
- [x] `POST /api/v1/screener/run` (sync + background)
- [x] `POST /api/v1/verify/auto`
- [x] BullMQ worker + `GET /api/v1/screener/jobs/:id`
- [x] WebSocket `/ws/jobs/:id` for job progress
- [x] React pages: Dashboard, Screener, Verify, Login
- [x] Docker Compose (`sv_api`, `sv_worker`, `sv_web`) on `shared_network`
- [x] Health endpoints `/health`, `/health/ready`

### Acceptance criteria

- [x] `pnpm dev` serves API on :3100 and web on :5173
- [x] Login with seed admin succeeds
- [x] Screener returns results for a small symbol set
- [x] `pnpm build` succeeds across workspace
- [x] `docker compose up` starts all three services

### Key artifacts

| Area | Path |
|------|------|
| API entry | `apps/api/src/server.ts` |
| Auth | `apps/api/src/lib/auth.ts`, `packages/shared/src/constants.ts` |
| Schema | `packages/db/prisma/schema.prisma` |
| Queues | `packages/jobs/src/index.ts` |
| Docker | `docker-compose.yml` |

**Depends on:** —

---

## M2 — Live data adapters ✅

**Goal:** Fetch real market data instead of static fixtures; cache in Redis with PHP-parity TTLs.

### Deliverables

- [x] `@sv/data-adapters` package
- [x] Yahoo Finance OHLC integration
- [x] Screener.in ratio scraping
- [x] Redis cache keys `sv:stock`, `sv:screener:row`, `sv:yahoo`
- [x] Verify and screener wired to live fetch
- [x] Graceful fallback when fetch fails

### Acceptance criteria

- [x] Verify TCS returns live price and ratios (or documented fallback)
- [x] Second verify within TTL hits Redis (faster response)
- [x] `CACHE_PREFIX` and `CACHE_TTL` documented in `packages/shared/src/constants.ts`

### Key artifacts

| Area | Path |
|------|------|
| Fetcher | `packages/data-adapters/src/stock-data-fetcher.ts` |
| Yahoo | `packages/data-adapters/src/yahoo.ts` |
| Screener.in | `packages/data-adapters/src/screener-in.ts` |
| Cache | `packages/cache/` |

**Depends on:** M1

---

## M3 — CFA engine parity ✅

**Goal:** Port PHP `CfaValuationEngine` with golden tests; add admin data uploads.

### Deliverables

- [x] Full `CfaValuationEngine` in `@sv/core` (DCF, P/B, EV/EBITDA, Graham floor, MOS)
- [x] Parity tests vs PHP `validate-logic.php`
- [x] Admin API: NSE equity + promoter holding CSV upload
- [x] Admin web page (`/admin`)
- [x] `total_nse` universe from NSE `EQUITY_L.csv`

### Acceptance criteria

- [x] `pnpm --filter @sv/core test` — 13 tests pass
- [x] TCS MOS, banking P/B, ONGC Graham floor match PHP fixtures
- [x] Admin upload updates `nse_equity_list` and universe counts

### Key artifacts

| Area | Path |
|------|------|
| Engine | `packages/core/src/valuation.ts` |
| Tests | `packages/core/src/parity.test.ts` |
| Admin service | `apps/api/src/services/admin.ts` |
| UI | `apps/web/src/pages/AdminPage.tsx` |

**Depends on:** M1, M2

---

## M4 — User data & PHP migration ✅

**Goal:** Persist user-owned data in PostgreSQL; provide CLI to import PHP JSON stores.

### Deliverables

- [x] Watchlists (`watchlists`, `watchlist_items`) with thesis/review meta
- [x] Verification history (`verification_runs`)
- [x] Swing positions table (`swing_positions`)
- [x] API: watchlist CRUD, verify history list
- [x] Web: Watchlist, Positions pages
- [x] `pnpm migrate:php -- --user <email>` CLI

### Acceptance criteria

- [x] Migrate PHP watchlist → visible on `/watchlist`
- [x] Migrate PHP `swing_positions.json` → visible on `/positions`
- [x] Verify run persisted and listed on `/verify`

### Key artifacts

| Area | Path |
|------|------|
| Migration CLI | `packages/db/src/migrate-php-data.ts` |
| Docs | [MIGRATION.md](MIGRATION.md) · [SWING-POSITIONS.md](SWING-POSITIONS.md) |
| UI | `apps/web/src/pages/WatchlistPage.tsx`, `PositionsPage.tsx` |

**Depends on:** M1, M3

---

## M5 — Swing scanner engine ✅

**Goal:** Port PHP swing TA scanner — GC9/DC9, E1–E11 entry rules, universe scan.

### Deliverables

- [x] `@sv/swing` package
- [x] Rules E1–E11, GC9/DC9 state machine, ranker
- [x] Yahoo daily OHLC (2y) + TA cache (`sv:ta`)
- [x] `POST /api/v1/swing/scan`, `POST /api/v1/swing/evaluate`
- [x] BullMQ queue `sv-swing-scan`
- [x] Web Swing page (`/swing`)
- [x] Parity tests vs PHP `testSwingGc9Entry`

### Acceptance criteria

- [x] Scan nifty50 returns ranked hits with verdicts
- [x] Single-symbol evaluate matches PHP GC9 fixture
- [x] Background scan when ≥ 25 symbols
- [x] `pnpm --filter @sv/swing test` passes

### Key artifacts

| Area | Path |
|------|------|
| Entry rules | `packages/swing/src/evaluate-entry.ts` |
| Scanner | `packages/swing/src/scanner.ts` |
| Chart adapter | `packages/data-adapters/src/swing-chart.ts` |
| UI | `apps/web/src/pages/SwingScanPage.tsx` |

**Depends on:** M2, M4

---

## M6 — Auto-radar, exit rules, intraday ✅

**Goal:** Swing position lifecycle, auto-radar tiers, and Nifty intraday module.

### Deliverables

- [x] Exit evaluation X1–X9 (`evaluateExit`)
- [x] `SwingAutoDecision` + `SwingAutoScreener` (four tiers: high_conviction, strict_enter, setup_radar, breakout_surge)
- [x] `@sv/intraday` — 13 presets, preflight, playbook
- [x] API: `GET /api/v1/swing/auto/state`, positions `?live=1`, intraday state
- [x] Web: Auto Radar (`/swing/auto`), Intraday (`/intraday`)
- [x] Position create/close API
- [x] Parity: exit, auto, intraday test suites

### Acceptance criteria

- [x] Open position shows live exit verdict and action label
- [x] Auto-radar state returns tiered hits
- [x] Intraday page shows Nifty direction and trade plan
- [x] 26+ new tests green across swing + intraday

### Key artifacts

| Area | Path |
|------|------|
| Exit | `packages/swing/src/evaluate-exit.ts` |
| Auto | `packages/swing/src/auto-screener.ts`, `auto-decision.ts` |
| Intraday | `packages/intraday/` |
| UI | `SwingAutoPage.tsx`, `IntradayPage.tsx`, `PositionsPage.tsx` |
| **Deep dive** | [SWING-AUTO.md](SWING-AUTO.md) · [SWING-POSITIONS.md](SWING-POSITIONS.md) |

**Depends on:** M5

---

## M7 — Live Nifty & auto-scan scheduler ✅

**Goal:** Live intraday charts, Redis auto snapshot, incremental universe scan, worker scheduler.

### Deliverables

- [x] Yahoo 5m/15m Nifty charts (`fetchNiftyIntradayCharts`)
- [x] `analyzeNiftyDirection`, MTF confluence, signal quality grading
- [x] Redis swing auto snapshot (`sv:swing:auto`)
- [x] Incremental scan: full every 30m, rotate batch 30
- [x] Worker tick 60s, `shouldStartAutoScan` (300s interval)
- [x] `POST /api/v1/swing/auto/scan`
- [x] Intraday `?refresh=1&interval=5m`
- [x] Scheduler moved to `@sv/data-adapters` (no worker → api import)

### Acceptance criteria

- [x] `pnpm dev:worker` runs auto-scan without manual trigger
- [x] Auto Radar shows snapshot `saved_at` updating
- [x] Intraday 5m/15m toggle returns different bar sets
- [x] Incremental merge preserves prior hits (`parity-incremental.test.ts`)

### Key artifacts

| Area | Path |
|------|------|
| Intraday charts | `packages/data-adapters/src/intraday-chart.ts` |
| Snapshot | `packages/swing/src/swing-auto-snapshot.ts` |
| Incremental | `packages/swing/src/incremental-scan.ts` |
| Scheduler | `packages/data-adapters/src/auto-swing-scheduler.ts` |
| Worker tick | `apps/worker/src/worker.ts` |

**Depends on:** M6

---

## M8 — Data foundation ✅

**Goal:** Real index universes in DB/Redis, live market regime, durable snapshots, admin index tools.

### Deliverables

- [x] `parseIndexCsvContent` (Market Watch + standard NSE CSV)
- [x] `syncAllIndicesFromDirectory`, `pnpm sync:indices`
- [x] `IndexConstituent` effective dating + `UniverseSymbol` sync
- [x] Redis `sv:index:*`, `sv:universe:*`
- [x] Universe resolution chain (Redis → DB → constituents → total_nse)
- [x] `regimeFromBars` + `currentMarketRegime()` (NIFTYBEES, `sv:regime:nifty`)
- [x] `SwingAutoSnapshotArchive` table + `getSwingAutoSnapshotDurable()`
- [x] Admin: index status, sync, upload API + UI
- [x] Unified `PageLayout` across all web pages
- [x] Rebrand to **Script Screener**
- [x] Full documentation set in `docs/`
- [x] 66 tests passing

### Acceptance criteria

- [x] `pnpm sync:indices` loads nifty50 (~50) and nifty500 (~750)
- [x] Swing scan uses full universe (not 10-symbol dev fallback after sync)
- [x] Auto-radar uses live regime (not static `defaultRegime()` stub)
- [x] Redis flush → auto state still loads from PostgreSQL archive
- [x] `pnpm build` green

### Key artifacts

| Area | Path |
|------|------|
| Index CSV | `packages/shared/src/index-csv.ts` |
| Index sync | `packages/data-adapters/src/index-sync.ts` |
| Universe | `packages/data-adapters/src/universe.ts` |
| Regime | `packages/swing/src/market-regime.ts` |
| Durable snapshot | `packages/data-adapters/src/auto-swing-scan.ts` |
| Schema | `SwingAutoSnapshotArchive` in `schema.prisma` |
| Docs | `docs/*.md` |

**Depends on:** M7

---

## M9 — Cache admin & job UX 🔲

**Goal:** Operational visibility into Redis; better developer and job-runner experience.

### Deliverables

- [ ] Admin UI: browse keys by `sv:*` prefix, clear selected prefix
- [ ] Chunked job progress (per-symbol status in worker)
- [ ] `pnpm dev:all` — API + web + worker in one command
- [ ] Verify endpoint uses `sv:verify` cache to avoid duplicate fetches
- [ ] Update [OPERATIONS.md](OPERATIONS.md) and [API.md](API.md)

**Parallel track — Full Verify (FV-A…FV-E):** see [FULL-VERIFY.md](FULL-VERIFY.md). Engine port (FV-C) shared with CFA Verify V-C.

**Parallel track — CFA Verify (V-A…V-D):** see [CFA-VERIFY.md](CFA-VERIFY.md). Cache wiring (V-A) ships with M9; memo UI follows.

**Parallel track — Stock Details (SD-A…SD-D):** see [STOCK-DETAILS.md](STOCK-DETAILS.md). Summary API + page can ship alongside M9; profile/chart phases SD-B/C follow.

### Acceptance criteria

- [ ] Admin can clear `sv:ta` without flushing entire DB
- [ ] Large screener job shows incremental `processed` count in UI
- [ ] Single `pnpm dev:all` starts full local stack
- [ ] Repeated verify within 7d TTL does not refetch Yahoo

### Key artifacts (planned)

| Area | Path |
|------|------|
| Cache admin API | `apps/api/src/services/admin.ts` (extend) |
| Cache admin UI | `apps/web/src/pages/AdminPage.tsx` (extend) |
| Root script | `package.json` → `dev:all` |
| Verify cache | `apps/api/src/services/verify.ts` |

**Depends on:** M8

---

## M10 — Morning dashboard & LTG auto 🔲

**Goal:** Daily briefing surface and long-term growth auto-screener pipeline.

### Deliverables

- [ ] Morning dashboard: regime, overnight tier changes, position alerts
- [ ] LTG auto-screener (fundamental + technical gate)
- [ ] Optional webhook/email on HOT tier additions
- [ ] New route `/morning` or enhanced Dashboard
- **Deep dive:** [MORNING-ROUTINE.md](MORNING-ROUTINE.md) — MR-A through MR-F

### Acceptance criteria

- [ ] Dashboard shows actionable summary without visiting 4 pages
- [ ] LTG scan runs on configured universe with documented filters
- [ ] Position alerts reflect X1–X9 live evaluation

**Depends on:** M8, M9 (cache admin helpful)

---

## M11 — Strategy builder 🔲

**Goal:** User-configurable screener and swing profiles stored in PostgreSQL.

**System strategies (read-only):** Port PHP `StrategyRegistry` (21 entries) per [TRADING-STRATEGIES.md](TRADING-STRATEGIES.md) TS-A–TS-F before user CRUD.

### Deliverables

- [ ] CRUD for `screener_presets` (user + system)
- [ ] Custom swing rule profiles (min verdict, zone, regime overrides)
- [ ] UI to save/load/run custom strategies
- [ ] API: `GET/POST/PUT/DELETE /api/v1/strategies`
- [ ] System strategy catalog: `GET /api/v1/strategies` + `/strategies` page (TS-A)

### Acceptance criteria

- [ ] Analyst can save a custom screener filter set and re-run it
- [ ] Custom swing profile persists across sessions
- [ ] System presets remain read-only

**Depends on:** M3, M5

---

## M12 — Backtesting & parity expansion 🔲

**Goal:** Historical validation of rules; broader PHP parity coverage.

### Deliverables

- [ ] Swing backtest runner (entry/exit on historical bars)
- [ ] Screener point-in-time backtest (where data allows)
- [ ] Expanded parity fixtures for edge cases
- [ ] Backtest report API + UI page

### Acceptance criteria

- [ ] Backtest reproduces known PHP historical run within tolerance
- [ ] Test count increases with documented fixtures
- [ ] CI runs full parity suite on PR

**Depends on:** M5, M6, M11

---

## M13 — Production hardening 🔲

**Goal:** Secure, observable, batch-capable deployment.

### Deliverables

- [ ] Batch verify API (`JobType.verify_batch`)
- [ ] Refresh token rotation (use existing `sessions` table)
- [ ] Per-user rate limiting (`sv:ratelimit`)
- [ ] Prometheus `/metrics` endpoint
- [ ] GitHub Actions: build + test on PR
- [ ] Production deployment guide

### Acceptance criteria

- [ ] Access token refresh without re-login
- [ ] Rate limit returns 429 after threshold
- [ ] `pnpm test` runs in CI on every PR
- [ ] Metrics expose job queue depth and worker heartbeat age

**Depends on:** M8–M12 (incremental)

---

## Cross-milestone engineering standards

Every milestone should meet these bars before marking **complete**:

| Standard | Requirement |
|----------|-------------|
| Build | `pnpm build` passes |
| Types | `pnpm typecheck` passes (no new errors) |
| Tests | New logic has parity or unit tests where applicable |
| API | New endpoints documented in [API.md](API.md) |
| UI | New pages documented in [WEB-UI.md](WEB-UI.md) |
| Schema | Prisma changes include `db:push` notes in PR |
| Ops | Env vars added to `.env.example` |

---

## Milestone completion workflow

1. **Plan** — Add/confirm milestone section in this file
2. **Implement** — Code in `packages/*`, thin wiring in `apps/*`
3. **Test** — `pnpm test`, manual smoke per acceptance criteria
4. **Document** — Update API, ARCHITECTURE, ROADMAP as needed
5. **Close** — Check all deliverables, update status table at top of this file

---

## PHP parity reference map

| PHP artifact | Milestone | TypeScript / test |
|--------------|-----------|-------------------|
| `validate-logic.php` | M3 | `packages/core/src/parity.test.ts` |
| `testSwingGc9Entry` | M5 | `packages/swing/src/parity.test.ts` |
| Swing exit rules | M6 | `packages/swing/src/parity-exit.test.ts` |
| Swing auto-radar | M6 | `packages/swing/src/parity-auto.test.ts` |
| Intraday presets | M6 | `packages/intraday/src/parity.test.ts` |
| Nifty direction | M7 | `packages/intraday/src/parity-direction.test.ts` |
| Incremental scan | M7 | `packages/swing/src/parity-incremental.test.ts` |
| Index CSV formats | M8 | `packages/shared/src/index-csv.test.ts` |
| Market regime | M8 | `packages/swing/src/parity-regime.test.ts` |

---

## Version history

| Date | Milestone | Notes |
|------|-----------|-------|
| — | M1–M7 | Initial rewrite from PHP stock-verifier |
| 2026-07 | M8 | Index sync, live regime, durable snapshots, Script Screener rebrand, docs |
| — | M9+ | Planned |

---

## Related documents

- [Roadmap](ROADMAP.md) — concise phase list and contribution guide
- [Architecture](ARCHITECTURE.md) — technical design per component
- [Packages](PACKAGES.md) — where to add code for each milestone
- [Operations](OPERATIONS.md) — how to verify milestones in running environments
- [Stock Details](STOCK-DETAILS.md) — single-symbol hub (planned; SD-A–SD-D)
- [CFA Verify](CFA-VERIFY.md) — one-click memo + 8-phase engine (V-A–V-D)
- [Full Verify](FULL-VERIFY.md) — allocation wizard, scorecard, thesis (FV-A–FV-E)
- [Morning Routine](MORNING-ROUTINE.md) — pre-market cockpit (MR-A–MR-F)
- [Trading Presets](TRADING-PRESETS.md) — swing / ETF / intraday profiles (TP-A–TP-F)
- [Trading Strategies](TRADING-STRATEGIES.md) — 21 curated strategies, hybrid pipeline (TS-A–TS-F)
