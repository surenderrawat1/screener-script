# Swing Positions — Architecture & Speed Plan

**Swing Positions** tracks open and closed Indian equity swing trades with live exit evaluation (X1–X9), trail-stop ratcheting, portfolio heat gates, and charge-aware P&L — integrated with Auto Radar for add/manage workflows.

This document maps the **PHP stock-verifier** position ledger to **Script Screener** architecture, explains performance characteristics, and defines the plan to reach full PHP parity.

> **CFA verification:** See [SWING-POSITIONS-CFA-VERIFICATION.md](SWING-POSITIONS-CFA-VERIFICATION.md) for graded parity report (7 Jul 2026).

> **Educational research tool only** — exit signals are advisory; user confirms all closes manually.

---

## Table of contents

1. [What it does](#what-it-does)
2. [PHP vs Script Screener](#php-vs-script-screener)
3. [Why the new architecture is faster](#why-the-new-architecture-is-faster)
4. [System architecture](#system-architecture)
5. [Data model](#data-model)
6. [Two-layer evaluation model](#two-layer-evaluation-model)
7. [Exit rules X1–X9](#exit-rules-x1x9)
8. [Position management actions](#position-management-actions)
9. [Trail stops & ratchet](#trail-stops--ratchet)
10. [Portfolio heat & add gates](#portfolio-heat--add-gates)
11. [P&L with charges](#pl-with-charges)
12. [Auto Radar integration](#auto-radar-integration)
13. [API mapping (PHP → v2)](#api-mapping-php--v2)
14. [UI surfaces](#ui-surfaces)
15. [Live refresh flow](#live-refresh-flow)
16. [Parity matrix](#parity-matrix)
17. [Speed optimization plan](#speed-optimization-plan)
18. [Implementation phases](#implementation-phases)
19. [File reference](#file-reference)

---

## What it does

| Capability | Description |
|------------|-------------|
| **Position ledger** | Open/closed trades with entry, stops, targets, shares, notes |
| **Live evaluation** | Current price, gain %, exit verdict, triggered X-rules |
| **Trail ratchet** | High-water mark + `trailed_stop_loss` floor (only moves up) |
| **Management actions** | EXIT, CUT, TIGHTEN, TRIM, HOLD, TRAIL, REVIEW |
| **Heat gate** | Max 10 open positions, 4% portfolio heat before new adds |
| **Source tracking** | `manual`, `swing_auto`, `php_import`, etc. |
| **Auto overlay** | Held symbols removed from high conviction tier |
| **Closed journal** | Exit price, reason (e.g. `X1`, `X4`, `manual`) |

---

## PHP vs Script Screener

| Aspect | PHP (`stock-verifier`) | Script Screener (`stock-verifier-v2`) |
|--------|------------------------|--------------------------------------|
| **Storage** | `data/swing_positions.json` (single file) | PostgreSQL `swing_positions` table |
| **Concurrency** | File lock on write | Prisma upserts, per-user rows |
| **Live API** | `swing-positions-api.php?refresh=1` | `GET /api/v1/swing/positions?live=1` |
| **Full UI** | `swing-positions.php` — CRUD, live table, P&L, journal | `PositionsPage` — live eval, add/close/edit, journal |
| **Live eval UI** | Inline on positions page + auto screener | `/positions` + `/swing/auto` |
| **Live quote** | `liveQuoteForSymbol()` (Yahoo intraday) | Same when NSE open |
| **Hourly bars (X9)** | Fetched in tracker | **Not wired** in `buildSymbolContext` |
| **Regime in refresh** | Passed to `evaluateExit` | ✓ via snapshot / `currentMarketRegime` |
| **Trail persistence** | JSON each refresh | ✓ `persistPositionTrailRatchet` |
| **P&L** | `SwingTradePnl` with STT, stamp, GST | ✓ `trade-pnl.ts` |
| **Closed stats** | `SwingClosedTradeStats`, CSV export | ✓ `summarizeClosedSwingPositions` + export |
| **60s poll** | Dedicated positions endpoint | ✓ `?live=1` on `/positions` |
| **Multi-user** | Single JSON file (implicit single user) | `userId` FK per position |

### Page mapping

| PHP | v2 | Status |
|-----|-----|--------|
| `swing-positions.php` | `/positions` | Live ledger + journal |
| `swing-positions-api.php` | `GET /api/v1/swing/positions?live=1` | API exists |
| `swing-positions-export.php` | `GET /api/v1/swing/positions/export` | ✓ |
| Auto screener positions panel | `/swing/auto` open positions table | Live eval shown |

---

## Why the new architecture is faster

### 1. PostgreSQL vs JSON file

| Operation | PHP | v2 |
|-----------|-----|-----|
| List open positions | Read + parse entire JSON | Indexed query `WHERE userId AND status='open'` |
| Close position | Rewrite whole file with lock | Single-row `UPDATE` |
| Concurrent users | File lock contention | Row-level isolation |
| Migration | Copy JSON | `pnpm migrate:php` one-time upsert |

### 2. Redis-cached TA (no refetch per refresh)

```
refreshOpenPositions(symbol)
  → buildSymbolContext(symbol)
       → cache hit: sv:ta / sv:stock (24h–7d)
       → cache miss: Yahoo daily bars once, then cached
  → refreshPosition(ta, price, bars)   // pure CPU, <5ms
```

PHP refetches context more aggressively on `?refresh=1`. v2 defaults to cache unless `refresh=true`.

### 3. Scoped live refresh (not full universe)

| Endpoint | Work done |
|----------|-----------|
| `GET /positions?live=1` | N open symbols only |
| `GET /auto/state` | Snapshot (Redis) + N open symbols |
| Full swing scan | 250 symbols — **separate** background job |

Refreshing 5 open positions: **~1–3s** (sequential, cache-warm).  
PHP equivalent: same symbol count, but often includes live quote + hourly fetch per symbol.

### 4. Per-user isolation

API filters by JWT `userId`. No parsing entire shared JSON to find one user's rows.

### 5. Target latency budget

| Action | Target | Current | After Phase A |
|--------|--------|---------|---------------|
| List positions (static) | <100ms | ~50ms | Same |
| Live refresh (5 open) | <1s | 1–3s sequential | <500ms parallel |
| Live refresh (10 open) | <2s | 2–5s | <1s parallel |
| Create/close position | <200ms | ~100ms | Same |
| Positions page 60s poll | Background | Manual visit only | Auto 60s poll |

---

## System architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        SWING POSITIONS                                   │
└─────────────────────────────────────────────────────────────────────────┘

  ┌──────────────┐                              ┌──────────────┐
  │ PositionsPage│  GET /swing/positions        │  SwingAuto   │
  │  /positions  │  (static)                    │    Page      │
  └──────┬───────┘                              └──────┬───────┘
         │                                             │
         │              GET /swing/positions?live=1      │ GET /auto/state
         │              POST /swing/positions          │
         │              POST /swing/positions/:id/close│
         └────────────────────┬────────────────────────┘
                              ▼
                    ┌─────────────────┐
                    │  swing-positions │  CRUD (Prisma)
                    │  swing-auto      │  refreshOpenPositions
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       ┌──────────┐  ┌──────────┐  ┌──────────┐
       │PostgreSQL│  │  Redis   │  │ @sv/swing│
       │swing_    │  │ sv:ta    │  │ evaluate │
       │positions │  │ sv:stock │  │ Exit     │
       └──────────┘  └──────────┘  │ refresh  │
                                     │ Position │
                                     │ portfolio│
                                     │ -risk    │
                                     └──────────┘
```

### Package responsibilities

| Package / app | Role |
|---------------|------|
| `@sv/swing` | `evaluateExit`, `refreshPosition`, `evaluatePositionAction`, `portfolio-risk` |
| `@sv/data-adapters` | `buildSymbolContext` (Yahoo daily + TA cache) |
| `@sv/db` | `SwingPosition` Prisma model |
| `apps/api` | CRUD routes + live refresh orchestration |
| `apps/web` | `PositionsPage`, position rows on `SwingAutoPage` |

---

## Data model

### PostgreSQL table: `swing_positions`

| Column | API field | Purpose |
|--------|-----------|---------|
| `id` | `id` | 16-char hex PK (preserved from PHP) |
| `user_id` | — | Owner (JWT `sub`) |
| `symbol` | `symbol` | NSE ticker |
| `status` | `status` | `open` \| `closed` |
| `entry_price` | `entry_price` | Entry price (₹) |
| `entry_date` | `entry_date` | `YYYY-MM-DD` |
| `shares` | `shares` | Quantity (0/null = no ₹ P&L) |
| `stop_loss` | `stop_loss` | User/plan hard stop |
| `profit_target` | `profit_target` | Frozen target for X2 |
| `notes` | `notes` | Thesis / auto label |
| `highest_since_entry` | `highest_since_entry` | High-water for trail |
| `trailed_stop_loss` | `trailed_stop_loss` | Ratchet floor |
| `closed_at` | `closed_at` | Close timestamp |
| `closed_price` | `closed_price` | Exit price |
| `closed_reason` | `closed_reason` | e.g. `X1`, `manual` |
| `source` | `source` | `manual`, `swing_auto`, `php_import` |

Indexes: `(user_id, status)`, `(symbol)`.

### PHP JSON schema (migration source)

```json
{
  "updated_at": "2026-07-02T10:00:00+05:30",
  "positions": [
    {
      "id": "a1b2c3d4e5f67890",
      "symbol": "TCS",
      "status": "open",
      "entry_price": 3500.0,
      "entry_date": "2026-06-01",
      "shares": 10,
      "stop_loss": 3325.0,
      "profit_target": 4025.0,
      "notes": "Auto Buy · D72",
      "highest_since_entry": 3650.0,
      "trailed_stop_loss": 3558.75,
      "source": "swing_auto",
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

Import: `pnpm migrate:php -- --user admin@example.com`

---

## Two-layer evaluation model

Swing positions use **two independent layers** (same as PHP):

### Layer 1 — Technical exit (`evaluateExit`)

Rules **X1–X9** → verdict `EXIT` or `HOLD` + triggered rule IDs.

Drives: stop/target hits, trail breach, RSI, trend break, etc.

### Layer 2 — Management action (`evaluatePositionAction`)

Human-readable guidance: **Exit now**, **Tighten stop**, **Cut loss**, **Trim**, **Hold**, **Trail**, **Review**.

Considers Layer 1 plus gain %, sessions held, scan conviction (on Auto page), chop regime.

```
Live price + TA bars
       │
       ▼
 evaluateExit (X1–X9)  ──► exit_verdict, exit_triggers, active_stop, trail_stop
       │
       ▼
 evaluatePositionAction ──► position_action, action_label, action_reasons
```

On **Auto Radar**, `buildState` re-runs `evaluatePositionAction` with **hit match** from scan for TRIM/HOLD logic.

---

## Exit rules X1–X9

**Engine:** `packages/swing/src/evaluate-exit.ts`  
**Parity tests:** `parity-exit.test.ts` (9 tests)

| ID | Name | EXIT when |
|----|------|-----------|
| **X1** | Stop-loss | `price <= active_stop` (hard + breakeven + structural + trail floor) |
| **X2** | Profit target | `price >= profit_target` (stored or computed 3R plan) |
| **X3** | Trend break | Bear: below SMA-50; or EMA-21 break + weak momentum + gain ≥ 4% |
| **X4** | RSI overbought | RSI > 65 and gain ≥ partial target threshold |
| **X5** | MACD momentum | Advisory only (does not trigger EXIT in v2) |
| **X6** | Trailing stop | `price <= trail_stop` after trail armed |
| **X7** | Time stop | Sideways regime: ≥15 sessions flat + weak EMA |
| **X8** | Price action | Bearish PA (LH/LL, engulfing) + gain ≥ 5% |
| **X9** | Hourly EMA | Hourly EMA-9 < EMA-21 + partial gain (**inactive in v2** — no hourly data) |

**Verdict:** `EXIT` if any rule `passed === true`; else `HOLD`.

### Key exit constants

| Constant | Value |
|----------|-------|
| `DEFAULT_TRAIL_FROM_HIGH_PCT` | 2.5% |
| `TRAIL_FROM_HIGH_BEAR_PCT` | 1.8% |
| `TRAIL_FROM_HIGH_HIGH_VOL_PCT` | 3.2% |
| `DEFAULT_TRAIL_ARM_PCT` | 2.0% |
| `BREAKEVEN_ARM_PCT` | 2.0% |
| `BREAKEVEN_BUFFER_PCT` | 0.35% |
| `EXIT_RSI_OVERBOUGHT` | 65 |
| `EXIT_RSI_MIN_GAIN_PCT` | 5.0% |
| `MIN_R_MULTIPLE` | 3.0 |
| `MIN_TARGET_PCT` / `MAX_TARGET_PCT` | 6% / 24% |
| `SIDEWAYS_TIME_STOP_DAYS` | 15 |

---

## Position management actions

**Function:** `evaluatePositionAction` in `auto-decision.ts`

Evaluated **after** `evaluateExit`. Priority order:

| Action | Constant | Trigger (summary) |
|--------|----------|-------------------|
| Exit now | `POS_EXIT` | `exit_verdict === EXIT` |
| Tighten stop | `POS_TIGHTEN` | Within 2% of active stop, or 1.5% of armed trail |
| Cut loss | `POS_CUT` | Gain ≤ -4% after ≥2 sessions |
| Trim profit | `POS_TRIM` | Gain ≥ 8% in chop, or gain ≥ 8% + scan SKIP |
| Hold | `POS_HOLD` | High conviction in scan + HOLD + stop OK |
| Trail active | `POS_TRAIL` | Trail armed + positive gain |
| Review | `POS_REVIEW` | Default; stagnant ≥12 sessions, gain < 3% |

| Threshold | Value |
|-----------|-------|
| `STOP_NEAR_PCT` | 2.0% |
| `TRAIL_NEAR_PCT` | 1.5% |
| `CUT_LOSS_PCT` | -4.0% |
| `TRIM_GAIN_PCT` | 8.0% |

---

## Trail stops & ratchet

### Computation (`computeTrailStop`, `computeActiveStop`)

1. **Breakeven** arms at `max(2%, 50% of target gain)` → stop lifts to entry + 0.35%
2. **Trail** arms after `DEFAULT_TRAIL_ARM_PCT` (2%) gain
3. **Trail distance** from high-water: 2.5% default, 1.8% bear, 3.2% high-vol regime
4. **EMA-9 trail** considered after 50% of target gain
5. **Active stop** = max(hard, breakeven, structural, trail floor)

### Persistence

| | PHP | v2 |
|---|-----|-----|
| High-water | `updateHighest()` → JSON on each eval | Computed in memory; **DB not updated** |
| Trail ratchet | `updateTrailStop()` → only moves up | `suggested_trailed_stop` returned; **DB not updated** |

**Gap:** After server restart, v2 may lose ratchet progress unless entry fields were set manually. Phase B fixes this.

---

## Portfolio heat & add gates

**Module:** `packages/swing/src/portfolio-risk.ts`

| Constant | Value |
|----------|-------|
| `MAX_OPEN_POSITIONS` | 10 |
| `MAX_PORTFOLIO_HEAT_PCT` | 4.0% |
| `MAX_RISK_PER_TRADE_PCT` | 1.0% |
| `DEFAULT_PORTFOLIO_NAV` | ₹10,00,000 |

**Heat** = sum of `(entry - stop) × shares` / NAV across open positions.

**`canOpenPosition()`** — blocks when:
- Open count ≥ 10
- Heat ≥ 4%

**`checkAddPosition()`** (auto-screener) also blocks:
- Duplicate open symbol
- `regime.blocks_strict_enter` (strong bear)

**`suggestedShares()`** — sizes position for 1% portfolio risk at given stop.

---

## P&L with charges

### PHP (`SwingTradePnl.php`) — **not yet in v2**

| Charge | Rate |
|--------|------|
| STT | 0.1% buy + sell |
| Stamp duty | 0.015% buy |
| NSE transaction | 0.00345% both legs |
| SEBI | ₹10 per crore turnover |
| GST | 18% on fees |
| DP charge (sell) | ₹15.93 default |

**`compute(entry, exit, shares)`** returns gross P&L, itemized charges, net P&L.

**`summarizeOpen()`** — portfolio bar: invested, current value, gross, net.

**`SwingClosedTradeStats`** — win rate, avg R, best/worst closed trades.

### v2 status

- Requires `shares > 0` for meaningful P&L (same as PHP)
- No API field for `pnl_detail` yet
- Positions page does not show gain % or net P&L

**Planned:** Phase B — port `SwingTradePnl` to `@sv/swing/trade-pnl.ts`

---

## Auto Radar integration

See also: [SWING-AUTO.md](SWING-AUTO.md)

### Open positions in incremental scan

`openSwingPositionSymbols()` adds held tickers to every incremental refresh set — scan data stays current for overlay logic.

### Tier overlay (`overlayOpenPositionsOnTiers`)

For each radar hit that is already held:

- Removed from `high_conviction` tier
- Marked `already_held: true`, `add_allowed: false`
- Near stop or TIGHTEN/CUT/EXIT → demoted to WATCH, “Held · manage stop”

### Add from Auto (PHP complete, v2 API only)

```
POST /api/v1/swing/auto/check-add  → heat + regime + duplicate check
POST /api/v1/swing/positions       → create with source: swing_auto
```

UI wiring: **Phase A** (see speed plan).

### `serializePosition` enrichment (Auto page)

Adds vs plain refresh: `position_action`, `action_label`, `stop_distance_pct`, `r_unrealized`, `in_high_conviction`.

---

## API mapping (PHP → v2)

| PHP | Script Screener | Notes |
|-----|-----------------|-------|
| `swing-positions-api.php` (default) | `GET /api/v1/swing/positions` | Static DB rows |
| `swing-positions-api.php?refresh=1` | `GET /api/v1/swing/positions?status=open&live=1` | Live eval |
| `swing-auto-api.php?action=positions` | `GET /api/v1/swing/auto/state` (positions section) | + tiers |
| POST `action=add` | `POST /api/v1/swing/positions` | **UI not on /positions** |
| POST `action=close` | `POST /api/v1/swing/positions/:id/close` | **UI not wired** |
| POST `action=update` | — | **Not implemented** |
| POST `action=remove` | — | **Not implemented** |
| `swing-auto-api.php?action=check_add` | `POST /api/v1/swing/auto/check-add` | |
| `swing-auto-api.php?action=add_position` | `POST /api/v1/swing/positions` | |
| `swing-positions-export.php` | — | Planned |

### Request/response examples

**Create position:**

```http
POST /api/v1/swing/positions
{ "symbol": "TCS", "entry_price": 3500, "entry_date": "2026-07-01",
  "shares": 10, "stop_loss": 3325, "profit_target": 4025, "notes": "Manual entry" }
```

**Live open positions:**

```http
GET /api/v1/swing/positions?status=open&live=1
```

Response adds per row: `current_price`, `gain_pct`, `exit_verdict`, `exit_triggers`, `position_action`, `action_label`, `active_stop`, `trail_stop`, etc.

**Close position:**

```http
POST /api/v1/swing/positions/a1b2c3d4e5f67890/close
{ "closed_price": 3650, "closed_reason": "X2" }
```

---

## UI surfaces

### `/positions` — `PositionsPage.tsx`

**Current:**
- Filter: open / closed / all
- Static table: symbol, entry, stop, target, closed price/reason
- Disclaimer pointing to Auto Radar for live eval

**Missing vs PHP `swing-positions.php`:**
- Live price, gain %, exit verdict, action label
- Add / edit / close forms
- P&L bar and charge breakdown
- 60s auto-refresh + countdown
- Closed trade journal stats
- CSV export

### `/swing/auto` — `SwingAutoPage.tsx`

**Current:**
- Open positions table with `exit_verdict`, `action_label`, `gain_pct`, `active_stop`
- Polls `/api/v1/swing/auto/state` every 60s
- No add/close buttons

---

## Live refresh flow

### v2 (`refreshOpenPositions`)

```
for each open position (sequential):
  buildSymbolContext(symbol, refresh?)
    → Redis sv:ta / sv:stock or Yahoo fetch
  price = ta.ta_price ?? last bar close
  refreshPosition(position, { ta, price, bars })
    → evaluateExit (regime NOT passed today — gap)
    → evaluatePositionAction
  return enriched row (not persisted to DB)
```

Called from:
- `GET /api/v1/swing/positions?live=1`
- `GET /api/v1/swing/auto/state` → `buildState` with regime from snapshot

### PHP (`SwingPositionTracker::evaluatePosition`)

```
SwingTradingContext::forSymbol()
liveQuoteForSymbol()          ← intraday quote
hourly bars for X9
regime → evaluateExit
updateTrailStop / updateHighest → persist to JSON
SwingTradePnl::compute()
```

### Timing

| Constant | Value | PHP usage | v2 usage |
|----------|-------|-----------|----------|
| `POSITION_REFRESH_INTERVAL_SEC` | 60 | Positions + auto poll | Auto page poll; profile metadata |
| PHP `REFRESH_MS` | 60000 | swing-positions.php | — |
| Auto state poll | 60s | 60s positions + 300s scan | 60s combined state |

---

## Parity matrix

| Feature | PHP | v2 | Gap |
|---------|-----|-----|-----|
| Exit X1–X9 logic | ✓ | ✓ tested | X9 needs hourly data |
| Position actions | ✓ | ✓ tested | — |
| Heat gate 10 / 4% | ✓ | ✓ | — |
| CRUD open/close/edit/delete | ✓ | ✓ API + UI | Edit UX (prompts) |
| Live quote (intraday) | ✓ | ✓ NSE session | — |
| Regime in exit eval | ✓ | ✓ | — |
| Trail/high persist | ✓ | ✓ DB ratchet | — |
| P&L + charges (open) | ✓ | ✓ | Expandable breakdown UI |
| Closed journal stats | ✓ | ✓ charge-aware net | — |
| CSV export | ✓ | ✓ | — |
| Reopen / undo close | — | ✓ | v2 enhancement |
| Full positions page UI | ✓ | B+ | Countdown, fetch-now, inline edit |
| Multi-user positions | ✗ | ✓ | v2 improvement |

See [SWING-POSITIONS-CFA-VERIFICATION.md](SWING-POSITIONS-CFA-VERIFICATION.md) for full checklist.

---

## Speed optimization plan

### Phase A — Positions page parity & fast live refresh (1–2 days)

**Goal:** `/positions` matches PHP usability; live refresh <1s for ≤10 positions.

| # | Task | Impact |
|---|------|--------|
| A1 | **Parallel** `refreshOpenPositions` (`Promise.all`, concurrency 5) | 3–5× faster live refresh |
| A2 | Pass `currentMarketRegime()` into `refreshPosition` context | Correct X3/X6/X7 |
| A3 | **Persist** `highestSinceEntry` + `trailedStopLoss` after each live refresh | Ratchet survives restart |
| A4 | Positions page: `?live=1` + 60s poll + exit verdict / action columns | PHP parity |
| A5 | Add / close forms on `/positions` | Full workflow without Auto page |
| A6 | Dedicated `GET /api/v1/swing/positions/live` (alias) for lightweight poll | Smaller payload than auto state |

### Phase B — Live quotes & P&L (2–3 days)

| # | Task | Impact |
|---|------|--------|
| B1 | Port `SwingTradePnl` → `@sv/swing/trade-pnl.ts` | Net P&L with charges |
| B2 | `liveQuoteForSymbol` in data-adapters (Yahoo quote endpoint) | Intraday price on refresh |
| B3 | Hourly bars fetch for X9 (cache `sv:ta:hourly:{sym}`) | X9 active |
| B4 | Portfolio summary bar on positions + auto pages | PHP `summarizeOpen` |
| B5 | `pnl_detail` on live position rows when `shares > 0` | Charge breakdown |

### Phase C — Journal & export (1 day)

| # | Task | Impact |
|---|------|--------|
| C1 | Port `SwingClosedTradeStats` — win rate, avg R | Closed journal |
| C2 | `GET /api/v1/swing/positions/export` CSV | PHP export parity |
| C3 | `PATCH /api/v1/swing/positions/:id` edit | PHP update action |
| C4 | `DELETE /api/v1/swing/positions/:id` | PHP remove action |

---

## Implementation phases

```
Now (M4/M6 shipped, partial UI)
  │
  ├─► Phase A: Fast parallel refresh + regime + persist trails + Positions UI
  │
  ├─► Phase B: Live quotes, P&L, hourly X9
  │
  └─► Phase C: Closed stats, export, edit/delete API
```

### Acceptance criteria — production-ready positions

- [ ] `/positions` shows live exit verdict + action with 60s auto-refresh
- [ ] Live refresh p95 < **1s** for 10 open positions (warm cache)
- [ ] Trail ratchet persists across API calls and server restart
- [ ] Regime-aware exit rules match PHP on same fixture
- [ ] Add and close work from `/positions` UI
- [ ] Net P&L with charges when shares > 0
- [ ] X9 fires when hourly structure bearish (with data)
- [ ] `pnpm migrate:php` positions visible with correct trails

---

## File reference

### Script Screener (v2)

```
packages/swing/src/
  evaluate-exit.ts       X1–X9, computeTrailStop, computeActiveStop
  position-tracker.ts    refreshPosition
  auto-decision.ts       evaluatePositionAction
  portfolio-risk.ts      heat gate, suggestedShares
  auto-screener.ts       checkAddPosition, serializePosition, buildState

packages/data-adapters/src/
  swing-chart.ts         buildSymbolContext (daily bars + TA)

apps/api/src/services/
  swing-positions.ts     list, create, close
  swing-auto.ts          refreshOpenPositions, getSwingAutoState

apps/web/src/pages/
  PositionsPage.tsx      /positions (static)
  SwingAutoPage.tsx      live position rows

packages/db/
  prisma/schema.prisma   SwingPosition model
  src/migrate-php-data.ts importSwingPositions
```

### PHP reference (stock-verifier)

```
swing-positions.php              Full UI + 60s poll
swing-positions-api.php          Live refresh API
swing-positions-export.php       CSV export
includes/SwingPositionStore.php  JSON CRUD
includes/SwingPositionTracker.php live eval + serialize
includes/SwingTradingRules.php   evaluateExit
includes/SwingTradePnl.php       charges P&L
includes/SwingClosedTradeStats.php
includes/SwingPortfolioRisk.php
data/swing_positions.json        Storage
```

### Tests (v2)

```
packages/swing/src/parity-exit.test.ts    9 tests (X1–X9)
packages/swing/src/parity-auto.test.ts    position action fixtures
```

Run: `pnpm --filter @sv/swing test`

---

## Related docs

- [Morning Routine](MORNING-ROUTINE.md) — swing positions panel + EXIT alerts
- [Swing Auto Radar](SWING-AUTO.md) — scanner, tiers, scheduler (positions overlay)
- [Trading Presets](TRADING-PRESETS.md) — conservative swing secondary links
- [API Reference](API.md) — swing position endpoints
- [Database](DATABASE.md) — `swing_positions` table
- [PHP Migration](MIGRATION.md) — import `swing_positions.json`
- [Milestones M4, M6](MILESTONES.md)
