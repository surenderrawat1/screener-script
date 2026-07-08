# Swing Auto Radar — Architecture & Speed Plan

**Swing Auto** is the always-on Nifty LargeMidcap 250 swing scanner: it ranks SETUP+ candidates into decision tiers, overlays open positions, and refreshes live exit guidance — without keeping a browser tab open.

This document maps the **PHP stock-verifier** behavior to **Script Screener** architecture, explains why the new stack is faster, and defines the plan to reach full parity plus sub-minute perceived latency.

> **Naming note:** Swing Auto does **not** use HOT/WARM/WATCH tabs. Those words appear as discovery verdicts (`ENTER`/`SETUP`/`WATCH`) or decision actions (`STRONG_BUY`/`BUY`/`WATCH`/`SKIP`). UI tiers are: **`high_conviction`**, **`strict_enter`**, **`setup_radar`**, **`breakout_surge`**.

---

## Table of contents

1. [What it does](#what-it-does)
2. [PHP vs Script Screener](#php-vs-script-screener)
3. [Why the new architecture is faster](#why-the-new-architecture-is-faster)
4. [System architecture](#system-architecture)
5. [Scan modes: full vs incremental](#scan-modes-full-vs-incremental)
6. [Tier & decision model](#tier--decision-model)
7. [Position overlay & exit evaluation](#position-overlay--exit-evaluation)
8. [Market regime](#market-regime)
9. [Storage: Redis + PostgreSQL](#storage-redis--postgresql)
10. [API mapping (PHP → v2)](#api-mapping-php--v2)
11. [Timing constants](#timing-constants)
12. [Parity matrix](#parity-matrix)
13. [Speed optimization plan](#speed-optimization-plan)
14. [Implementation phases](#implementation-phases)
15. [File reference](#file-reference)

---

## What it does

| Capability | Description |
|------------|-------------|
| **Universe scan** | Nifty 250 (`nifty250`), SETUP+ minimum verdict, ranked by `swing_rank` |
| **Scheduled scans** | Every 5 minutes when due; full universe every 30 minutes |
| **Incremental refresh** | Between full scans: open positions + prior hits + rotating batch of 30 |
| **Tier buckets** | Four parallel tiers for discovery (see below) |
| **Decision scoring** | STRONG_BUY / BUY / WATCH / SKIP per hit |
| **Position overlay** | Held symbols removed from high conviction; demoted in other tiers |
| **Live positions** | Exit rules X1–X9 + management actions (TIGHTEN, CUT, TRIM, TRAIL) |
| **Regime gate** | NIFTYBEES daily regime adjusts 52w bands and blocks strict enter in strong bear |
| **Heat gate** | Max 10 open positions, 4% portfolio heat before new adds |

---

## PHP vs Script Screener

| Aspect | PHP (`stock-verifier`) | Script Screener (`stock-verifier-v2`) |
|--------|------------------------|--------------------------------------|
| **Scheduler** | Browser tab polls every 5m; **no cron** | Worker tick every 60s; **server-side** |
| **Scan worker** | `exec php run-swing-scan-job.php &` | BullMQ `sv-swing-scan` queue |
| **Snapshot cache** | `DataCache` SQLite/file `swing_auto:snapshot` | Redis `sv:swing:auto:SNAPSHOT` (2h TTL) |
| **Snapshot durability** | Cache only (lost on clear) | Redis + PostgreSQL `swing_auto_snapshots` archive |
| **Job tracking** | `swing_scan_job:job:{id}` in DataCache | `jobs` table + Redis `sv:job:progress:{id}` |
| **Universe data** | Index CSV on disk | PostgreSQL + Redis `sv:universe:nifty250` |
| **Regime** | `SwingMarketRegime::current()` per request | `currentMarketRegime()` + Redis `sv:regime:NIFTY` (15m) |
| **TA cache** | Per-request Yahoo fetch | Redis `sv:ta:{symbol}` (24h) |
| **Positions store** | `data/swing_positions.json` | PostgreSQL `swing_positions` |
| **API** | `swing-auto-api.php?action=` | REST `/api/v1/swing/auto/*` |
| **UI** | `swing-auto-screener.php` (inline JS) | React `SwingAutoPage` (`/swing/auto`) |
| **Auth** | PHP session | JWT + RBAC |
| `SwingAutoBacktestTruth` (top 40 hits) | **Ported** — see [SWING-AUTO-CFA-VERIFICATION.md](SWING-AUTO-CFA-VERIFICATION.md) | `auto-backtest-truth.ts`, `attachBacktestTruthToHits` |

### Critical behavioral change

**PHP requires an open browser** to trigger scans via `setInterval(scanCycle, 300s)`. If nobody has the page open, scans stop.

**Script Screener runs scans in the worker** — auto-radar continues 24/7 when `pnpm dev:worker` or `sv_worker` is running.

---

## Why the new architecture is faster

### 1. Server-side scheduler (no browser dependency)

```
PHP:  User browser ──5m──► API ──spawn──► CLI job
v2:   Worker ──60s tick──► shouldStartAutoScan ──► BullMQ (async)
```

The worker checks every **60 seconds** but only scans when snapshot age ≥ **300 seconds**. Scans never wait for a human to open a tab.

### 2. Incremental scans (~80% fewer symbols most cycles)

| Mode | Symbols scanned | When |
|------|-----------------|------|
| **Full** | ~250 (entire Nifty 250) | Every 30m, regime change, empty snapshot |
| **Incremental** | ≤120 (typically 30–80) | All other 5m cycles |

Incremental set = **open positions** ∪ **prior hit symbols** ∪ **rotate batch of 30**.

```
Full scan:     250 symbols × ~2s TA  ≈ 8–15 min (background)
Incremental:    60 symbols × ~2s TA  ≈ 2–4 min (background)
               (cache hits: <500ms/symbol)
```

### 3. Layered Redis cache

| Layer | Key | TTL | Effect |
|-------|-----|-----|--------|
| Universe list | `sv:universe:nifty250` | 24h | No DB read per scan |
| Regime | `sv:regime:NIFTY` | 15m | No NIFTYBEES fetch per scan |
| TA indicators | `sv:ta:{SYMBOL}` | 24h | Skip Yahoo + recompute on cache hit |
| Stock OHLC | `sv:stock:{SYMBOL}` | 7d | Raw bars cached |
| Snapshot | `sv:swing:auto:SNAPSHOT` | 2h | Instant state API (<50ms) |

**State API path:** Redis snapshot → `buildState()` → per-user position refresh only for open symbols (not full rescan).

### 4. Non-blocking API

| Operation | PHP | v2 |
|-----------|-----|-----|
| Full N250 scan | Blocks until CLI completes or polls | BullMQ job; API returns immediately |
| State read | Rebuilds tiers + refreshes positions | Reads snapshot; refreshes N open positions only |
| Manual scan trigger | `POST start` + poll 2.5s | `POST /scan` → job id or inline |

### 5. PostgreSQL vs JSON files

- Universe symbols: indexed query vs reading CSV
- Positions: concurrent-safe upserts vs file lock on `swing_positions.json`
- Job history: queryable `jobs` table vs ephemeral cache keys

### 6. Target latency budget (v2 current + planned)

| User action | Target | Current | After Phase A (below) |
|-------------|--------|---------|------------------------|
| Load `/swing/auto` state | <300ms | ~500ms–2s (N open positions) | <200ms snapshot + async position stream |
| Scan due → snapshot updated | <5m | 5m + job duration | Same; job progress visible |
| Incremental job (60 symbols) | <3m | 2–4m | <2m with parallel symbol fetch |
| Full job (250 symbols) | <12m | 8–15m | <8m with batch parallel + TA cache warming |
| Position price refresh | <60s | On each state load | Dedicated 60s poll endpoint |

---

## System architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         SWING AUTO RADAR                                  │
└──────────────────────────────────────────────────────────────────────────┘

  ┌─────────────┐     GET /swing/auto/state      ┌─────────────┐
  │ SwingAuto   │ ◄────────────────────────────► │   Fastify   │
  │   Page      │     POST /swing/auto/scan      │     API     │
  └─────────────┘                                └──────┬──────┘
                                                        │
         ┌──────────────────────────────────────────────┼──────────────────┐
         │                                              │                  │
         ▼                                              ▼                  ▼
  ┌─────────────┐                              ┌─────────────┐    ┌─────────────┐
  │   Redis     │◄── snapshot / regime / TA  │  @sv/swing  │    │ PostgreSQL  │
  │  sv:* keys  │                              │ auto-*      │    │ jobs,       │
  └──────▲──────┘                              │ incremental │    │ positions,  │
         │                                      │ decision    │    │ snapshots   │
         │                                      └──────▲──────┘    └─────────────┘
         │                                             │
  ┌──────┴──────┐         BullMQ sv-swing-scan         │
  │   Worker    │ ─── tick 60s ──► shouldStartAutoScan │
  │             │ ─── executeAutoScanPlan ────────────┘
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐     Yahoo 2y daily      ┌─────────────┐
  │ @sv/data-   │ ◄──────────────────────►│ Screener.in │
  │  adapters   │     NIFTYBEES regime    │  (optional) │
  └─────────────┘                         └─────────────┘
```

### Package responsibilities

| Package | Swing auto modules |
|---------|-------------------|
| `@sv/swing` | `auto-screener`, `auto-decision`, `incremental-scan`, `swing-auto-snapshot`, `market-regime`, `evaluate-exit`, `portfolio-risk` |
| `@sv/data-adapters` | `auto-swing-scheduler`, `auto-swing-scan`, `market-regime`, `swing-scan`, `universe` |
| `@sv/jobs` | `sv-swing-scan` queue, background threshold (25) |
| `@sv/cache` | Redis get/set, job progress pub/sub |
| `@sv/db` | `jobs`, `swing_positions`, `swing_auto_snapshots` |

---

## Scan modes: full vs incremental

### Decision: `shouldRunFullScan(snapshot, regimeKey)`

Returns **true** when any of:

1. No snapshot exists
2. `last_full_scan_at` ≥ **1800s** (30 min) ago
3. Regime `key` changed since last snapshot
4. Previous hits array is empty

### Full scan plan

```typescript
{
  universe: 'nifty250',
  scan_mode: 'full',
  symbols: [...250 symbols from resolveUniverseSymbols],
  min_verdict: 'SETUP_PLUS',
  auto_radar: true,
  regime: { key: 'bull', ... }
}
```

### Incremental scan plan

```typescript
{
  scan_mode: 'incremental',
  symbols: refreshSet,          // ≤ 120 symbols
  refresh_symbols: refreshSet,
  rotate_offset: nextOffset,    // advances by ROTATE_BATCH (30)
  last_full_scan_at: '...',
  auto_radar: true,
  regime: { ... }
}
```

### `buildRefreshSet` algorithm

```
refresh = open_position_symbols
        ∪ hit_symbols_from_snapshot
        ∪ universe[rotate_offset : rotate_offset + 30]
cap at MAX_REFRESH_SYMBOLS (120)
```

### `mergeHits` (incremental only)

- Symbols **not** in refresh set: carried forward with `incremental_stale: true`
- Symbols **in** refresh set: replaced with fresh scan results
- Re-sorted by `swing_rank` + `rules_passed` tiebreaker

---

## Tier & decision model

### UI tiers (`categorizeHits`)

A symbol may appear in **multiple** tiers.

| Tier key | Label | Inclusion rule |
|----------|-------|----------------|
| `high_conviction` | High conviction | `high_conviction === true` |
| `strict_enter` | Strict enter | `strict_verdict === 'ENTER'` |
| `setup_radar` | Setup radar | discovery `ENTER` or `SETUP` |
| `breakout_surge` | Breakout surge | `broke_swing_high` AND `volume_ratio ≥ 1.08` |

Sort within tier: `decision_score` ↓, then `swing_rank` ↓.

### High conviction (`isHighConviction`)

- `STRONG_BUY` action → always
- `BUY` + score ≥ 72 + strict ENTER + R-multiple ok + no STALE/LOW_R flags
- `BACKTEST_WEAK` requires score ≥ 78 (backtest overlay **not yet in v2**)

### Decision actions (`entryAction`)

| Action | Min score | Requirements |
|--------|-----------|--------------|
| `STRONG_BUY` | 78 | strict ENTER, R ok, no stale data |
| `BUY` | 65 | strict or discovery ENTER |
| `WATCH` | 50 | ENTER or SETUP |
| `SKIP` | — | else / blockers |

### Risk flags affecting score

RSI chase (>72), 52w extended (>88%), low R-multiple, stale incremental data, regime blocks.

---

## Position overlay & exit evaluation

### Two-layer model (same as PHP)

**Layer 1 — Technical exit (`evaluateExit` X1–X9)**

Stop loss, trail, breakeven, profit target, trend break, RSI, time stop, price action, hourly EMA.

**Layer 2 — Management action (`evaluatePositionAction`)**

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 | `exit_verdict === EXIT` | `POS_EXIT` |
| 2 | Price within 2% of stop | `POS_TIGHTEN` |
| 3 | Loss ≤ -4% after ≥2 sessions | `POS_CUT` |
| 4 | Trail within 1.5% when armed | `POS_TIGHTEN` |
| 5 | Gain ≥ 8% in chop regime | `POS_TRIM` |
| 6 | Gain ≥ 8% + scan SKIP | `POS_TRIM` |
| 7 | Still high conviction + HOLD | `POS_HOLD` |
| 8 | Trail armed + gain > 0 | `POS_TRAIL` |
| 9 | Default | `POS_REVIEW` |

### Tier overlay (`overlayOpenPositionsOnTiers`)

- Open symbols **removed** from `high_conviction`
- Other tiers: `already_held: true`, `add_allowed: false`
- Near stop or TIGHTEN/CUT/EXIT → demote to WATCH action, `high_conviction: false`

### Add position gates (`checkAddPosition`)

- No duplicate open symbol (per user)
- `regime.blocks_strict_enter` → blocked
- `canOpenPosition()`: max **10** positions, **4%** portfolio heat

---

## Market regime

**Proxy:** `NIFTYBEES` daily bars  
**Function:** `regimeFromBars()` → cached via `currentMarketRegime()` in Redis (15m TTL)

| Regime key | Entry 52w band (min–max %) | Notes |
|------------|----------------------------|-------|
| `bull` | 25–75 | Price ≥ SMA200, SMA50 ≥ SMA200, 20d ret > 0 |
| `bear` | 20–55 | Price < SMA200 or SMA50 < SMA200 |
| `strong_bear` | 20–50 | Bear + deep drawdown; **blocks strict enter** |
| `sideways` | 32–68 | Default band |
| `neutral` | 32–68 | Fallback |

**Regime change forces full scan** even inside the 30-minute window.

`regimeGuidance()` returns deploy % cap (50% strong bear → 100% bull) for UI banner.

---

## Storage: Redis + PostgreSQL

### Redis keys (swing auto)

| Key | TTL | Content |
|-----|-----|---------|
| `sv:swing:auto:SNAPSHOT` | 7200s | Full snapshot JSON |
| `sv:regime:NIFTY` | 900s | Regime object |
| `sv:universe:NIFTY250` | 86400s | Symbol array |
| `sv:ta:{SYMBOL}` | 86400s | Computed indicators |
| `sv:job:progress:{jobId}` | 3600s | Scan job progress |
| `sv:worker:heartbeat:{id}` | 120s | Worker alive |

### Snapshot structure

```json
{
  "saved_at": "2026-07-02T10:05:00.000Z",
  "last_full_scan_at": "2026-07-02T09:45:00.000Z",
  "rotate_offset": 60,
  "scan": {
    "hits": [...],
    "hit_count": 42,
    "scanned": 87,
    "scan_mode": "incremental",
    "regime": { "key": "bull", ... },
    "engine_version": "v3.9-gc9"
  },
  "tiers": {
    "high_conviction": [...],
    "strict_enter": [...],
    "setup_radar": [...],
    "breakout_surge": [...]
  },
  "summary": {
    "high_conviction": 5,
    "strict_enter": 12,
    "setup_radar": 28,
    "breakout_surge": 3
  }
}
```

### PostgreSQL archive

Table: `swing_auto_snapshots`  
Written after every successful scan (non-fatal on failure).  
Read when Redis key missing: `getSwingAutoSnapshotDurable()`.

---

## API mapping (PHP → v2)

| PHP `swing-auto-api.php` | Script Screener | Notes |
|--------------------------|-----------------|-------|
| `GET ?action=state` | `GET /api/v1/swing/auto/state` | Per-user positions |
| `GET ?action=positions` | Positions included in state; `GET /api/v1/swing/positions?live=1` | v2: no separate 60s positions endpoint yet |
| `POST ?action=check_add` | `POST /api/v1/swing/auto/check-add` | **UI not wired** |
| `POST ?action=add_position` | `POST /api/v1/swing/positions` | **UI not wired on auto page** |
| `POST ?action=start` | `POST /api/v1/swing/auto/scan` | 409 if not due |
| — | `GET /api/v1/swing/auto/profile` | Engine metadata |
| — | `GET /api/v1/screener/jobs/:id` | Job status for background scan |
| — | `WS /ws/jobs/:id` | Progress stream (**UI not wired**) |

---

## Timing constants

| Constant | Value | PHP | v2 | Purpose |
|----------|-------|-----|-----|---------|
| `SCAN_INTERVAL_SEC` | 300 | ✓ | ✓ | Min gap between scans |
| `FULL_SCAN_INTERVAL_SEC` | 1800 | ✓ | ✓ | Force full N250 |
| `POSITION_REFRESH_INTERVAL_SEC` | 60 | ✓ | ✓ (profile only) | Position quote refresh |
| `ROTATE_BATCH` | 30 | ✓ | ✓ | Incremental rotation |
| `MAX_REFRESH_SYMBOLS` | 120 | ✓ | ✓ | Incremental cap |
| Worker tick | 60s | — | ✓ | `AUTO_SCAN_TICK_MS` |
| UI poll (state) | 60s | 5m scan + 60s positions | 60s state only | See speed plan |
| Job poll (PHP) | 2.5s | ✓ | — | v2: use WebSocket |
| `BACKGROUND_THRESHOLD` | 25 | ✓ | ✓ | Queue vs inline |
| Snapshot TTL | 7200s | ✓ | ✓ | Redis expiry |
| Regime cache TTL | — | per request | 900s | v2 improvement |

Default universe: **`nifty250`**  
Default filters: **`SETUP_PLUS`**, sort **`swing_rank`**, zone **`any`**.

---

## Parity matrix

| Feature | PHP | v2 | Gap |
|---------|-----|-----|-----|
| Server scheduler | ✗ (browser) | ✓ worker | — |
| Full / incremental scan | ✓ | ✓ | — |
| 4 UI tiers | ✓ | ✓ | — |
| Decision scoring | ✓ | ✓ | — |
| Position overlay | ✓ | ✓ | — |
| Exit X1–X9 | ✓ | ✓ | — |
| Position management actions | ✓ | ✓ | — |
| Regime from NIFTYBEES | ✓ | ✓ | — |
| Heat gate (10 pos / 4%) | ✓ | ✓ | — |
| `incremental_stale` flag | ✓ | ✓ | UI badge on stale rows |
| Backtest truth overlay | ✓ | ✓ | `auto-backtest-truth.ts` |
| Add position from auto UI | ✓ | ✓ | Confirm dialog + heat gate |
| 60s positions-only poll | ✓ | ✓ | `SwingAutoPage` |
| 2.5s job poll while scanning | ✓ | ✓ | Manual scan poll |
| `?tier=strict_enter` URL | ✓ | ✓ | — |
| Compact KPI pills | ✓ | ✓ | High conv / strict / SETUP+ |
| Price freshness badges | ✓ | ✓ | `PriceFreshness` component |
| Morning dashboard panel | ✓ | ✗ | [MORNING-ROUTINE.md](MORNING-ROUTINE.md) MR-B |
| Rate limit 120/min | ✓ | partial | Phase 13 |

---

## Speed optimization plan

### Phase A — UI & API latency (1–2 days)

**Goal:** Match PHP page responsiveness; state loads in <300ms perceived.

| # | Task | Impact |
|---|------|--------|
| A1 | Split state: `GET /swing/auto/state?positions=0` for snapshot-only; poll positions every 60s separately | Faster tier render |
| A2 | Wire WebSocket job progress on Run scan + auto-start | No blind wait |
| A3 | Show `scan_mode`, `next_full_scan_in`, `incremental_stale` badge | User trust |
| A4 | Tier tabs + `?tier=strict_enter` URL param | PHP parity |
| A5 | Wire check-add → add-position flow on auto page | Complete workflow |
| A6 | Use `profile.refresh_sec` / `profile.scan_sec` for poll intervals | Config-driven |

### Phase B — Scan throughput (2–3 days)

**Goal:** Incremental <2m, full <8m for 250 symbols.

| # | Task | Impact |
|---|------|--------|
| B1 | Parallel symbol fetch in `runSwingScan` (concurrency 5–10) | 3–5× faster scans |
| B2 | Skip Yahoo fetch when `sv:ta` fresh (<24h) and `refresh=false` | Cache hit path |
| B3 | Pre-warm TA cache after full scan (background low-priority) | Next incremental faster |
| B4 | Port `SwingAutoBacktestTruth` for top 40 hits | Better ranking; PHP parity |
| B5 | Batch Redis `MGET` for TA keys in refresh set | Fewer round trips |

### Phase C — Operational speed (1–2 days)

**Goal:** Zero-downtime radar; no stale state after Redis flush.

| # | Task | Impact |
|---|------|--------|
| C1 | Snapshot read: always try Redis, fallback DB, warm Redis on DB hit | Instant recovery |
| C2 | Prune `swing_auto_snapshots` (keep last 48h or last 100 rows) | DB performance |
| C3 | `pnpm dev:all` — API + web + worker single command | Dev velocity |
| C4 | Health alert when `worker.ok: false` on Dashboard | Ops visibility |
| C5 | Optional: leader election if multiple workers | Safe scale-out |

### Phase D — Advanced (Phase 10–12 roadmap)

- Morning briefing — see [MORNING-ROUTINE.md](MORNING-ROUTINE.md) (regime + top 5 high conviction + position alerts)
- Intraday confluence badge on auto hits
- Historical replay / backtest of auto tiers

---

## Implementation phases

```
Now (M6–M8 complete)
  │
  ├─► Phase A: UI parity + fast state (positions split, WS, add flow)
  │
  ├─► Phase B: Scan throughput (parallel fetch, backtest truth)
  │
  └─► Phase C: Ops (DB prune, dev:all, cache warm)
```

### Acceptance criteria — “very fast” swing auto

- [ ] State API (snapshot only) p95 < **200ms**
- [ ] Open positions refresh p95 < **2s** for ≤10 positions
- [ ] Incremental scan job completes < **2 minutes** (60 symbols, warm cache)
- [ ] Full scan job completes < **8 minutes** (250 symbols)
- [ ] Worker runs scans without browser; Dashboard shows worker green
- [ ] UI shows job progress during scan (WebSocket)
- [ ] Add position works from auto page with heat/regime gates
- [x] Add position works from auto page with heat/regime gates
- [ ] Redis flush → state still loads from PostgreSQL < **500ms**

---

## File reference

### Script Screener (v2)

```
packages/swing/src/
  auto-screener.ts       buildState, scanInput, profile, checkAddPosition
  auto-decision.ts       categorizeHits, enrichHit, evaluatePositionAction
  incremental-scan.ts    shouldRunFullScan, buildRefreshSet, mergeHits
  swing-auto-snapshot.ts getSwingAutoSnapshot, saveSwingAutoSnapshot
  market-regime.ts       regimeFromBars, defaultRegime
  evaluate-exit.ts       X1–X9 exit rules
  portfolio-risk.ts      heat gate, suggested shares

packages/data-adapters/src/
  auto-swing-scheduler.ts  shouldStartAutoScan, buildAutoScanPlan, tickSwingAutoScan
  auto-swing-scan.ts       executeAutoScanPlan, getSwingAutoSnapshotDurable
  market-regime.ts         currentMarketRegime
  swing-scan.ts            runSwingScan

apps/worker/src/worker.ts           AUTO_SCAN_TICK_MS = 60_000
apps/api/src/services/swing-auto.ts getSwingAutoState
apps/web/src/pages/SwingAutoPage.tsx
```

### PHP reference (stock-verifier)

```
swing-auto-screener.php          UI + client scheduler
swing-auto-api.php               JSON API
includes/SwingAutoScreener.php   Orchestrator
includes/SwingAutoIncrementalScan.php
includes/SwingAutoDecision.php
includes/SwingAutoBacktestTruth.php   ← not yet ported
includes/SwingMarketRegime.php
includes/SwingScanJob.php
run-swing-scan-job.php           CLI worker
```

### Tests (v2 parity)

```
packages/swing/src/parity-auto.test.ts
packages/swing/src/parity-incremental.test.ts
packages/swing/src/parity-regime.test.ts
packages/swing/src/parity-exit.test.ts
```

Run: `pnpm --filter @sv/swing test`

---

## Related docs

- [Architecture](ARCHITECTURE.md) — system-wide data flows
- [Swing Positions](SWING-POSITIONS.md) — exit X1–X9, trail, P&L plan
- [API Reference](API.md) — swing auto endpoints
- [Redis & Cache](REDIS-CACHE.md) — key namespaces
- [Operations](OPERATIONS.md) — worker, auto-scan scheduler
- [Milestones M6–M8](MILESTONES.md) — when swing auto shipped
- [Roadmap Phase 10](ROADMAP.md) — morning dashboard
- [Morning Routine](MORNING-ROUTINE.md) — aggregated cockpit plan
- [Trading Presets](TRADING-PRESETS.md) — conservative swing → strict ENTER link
- [Trading Strategies](TRADING-STRATEGIES.md) — swing engine strategies (`swing_strict_enter`, etc.)
