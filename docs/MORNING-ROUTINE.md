# Morning Routine — Architecture & Speed Plan

**Morning Routine** is the pre-market research cockpit: one screen for NSE session status, swing regime, open position alerts, Nifty 15m direction, ETF SETUP+ book, and Swing Auto high-conviction names — plus a linked morning checklist.

In **Script Screener v2 this page does not exist.** The Dashboard shows system health and quick links only. Building blocks (regime, auto snapshot, swing position refresh, intraday state) exist across packages but are **not composed** into a morning briefing API or UI.

> Research cockpit only — uses cached Yahoo data and last Swing Auto snapshot. Confirm on NSE before orders.

**Related:** [Swing Auto](SWING-AUTO.md) · [Swing Positions](SWING-POSITIONS.md) · [Nifty Intraday](INTRADAY.md) · [Nifty Positions](NIFTY-POSITIONS.md)

---

## Table of contents

1. [What it does](#what-it-does)
2. [PHP vs Script Screener](#php-vs-script-screener)
3. [Analyst workflow](#analyst-workflow)
4. [Why the new architecture can be faster](#why-the-new-architecture-can-be-faster)
5. [System architecture (planned)](#system-architecture-planned)
6. [Data aggregation](#data-aggregation)
7. [Morning checklist](#morning-checklist)
8. [UI panels](#ui-panels)
9. [Trading presets](#trading-presets)
10. [Alerts](#alerts)
11. [Cache layers](#cache-layers)
12. [API mapping (PHP → v2)](#api-mapping-php--v2)
13. [Parity matrix](#parity-matrix)
14. [Speed optimization plan](#speed-optimization-plan)
15. [Implementation phases](#implementation-phases)
16. [File reference](#file-reference)

---

## What it does

| Capability | Description |
|------------|-------------|
| **One-screen briefing** | Regime, positions, intraday, ETF, auto radar — no tab hopping |
| **NSE session banner** | Market phase (pre-open, open, closed) + EOD date |
| **Swing regime** | NIFTYBEES proxy, 20d/60d returns, deploy % guidance |
| **Action alerts** | Red banner when swing EXIT or intraday exit signals fire |
| **Morning checklist** | 7 linked steps with ok/warn/muted status dots |
| **Nifty 15m card** | Direction, confidence, setup grade, entry window |
| **Swing positions** | Top 5 open rows: price, P&L %, exit verdict, portfolio net P&L |
| **Intraday positions** | Top 5 ledger rows (Nifty positions — PHP only today in v2) |
| **ETF SETUP+** | Swing ETF universe scan, top 5 hits, TER, liquidity flags |
| **Swing Auto** | Top 5 `high_conviction` from cached N250 snapshot |
| **Trading presets** | Quick-launch chips: conservative swing, ETF rotation, intraday |
| **Refresh ETF** | `?refresh_etf=1` bypasses 10m ETF scan cache |

---

## PHP vs Script Screener

| Aspect | PHP (`stock-verifier`) | Script Screener (`stock-verifier-v2`) |
|--------|------------------------|--------------------------------------|
| **Page** | `morning-dashboard.php` (nav: Morning) | **No route** |
| **Planned route** | — | `/morning` or enhanced `/` |
| **Orchestrator** | `MorningDashboard::build()` | **Not implemented** |
| **API** | Server-rendered HTML | **No** `GET /api/v1/morning` |
| **NSE session** | `PriceFreshness::nseSession()` | **Not ported** (intraday has session-regime per chart) |
| **Swing regime** | `SwingMarketRegime::current()` | `currentMarketRegime()` ✅ (`sv:regime:nifty`) |
| **Regime guidance** | `SwingAutoDecision::regimeGuidance()` | `regimeGuidance()` in `@sv/swing` ✅ |
| **Nifty 15m** | `Nifty15mDirection::analyze()` | `GET /intraday/nifty/state` ✅ (separate page) |
| **Swing positions** | `SwingPositionTracker::trackOpen()` | `refreshOpenPositions()` ✅ (Positions API `?live=1`) |
| **Intraday positions** | `NiftyIntradayPositionTracker` | **Not built** — [NIFTY-POSITIONS.md](NIFTY-POSITIONS.md) |
| **ETF SETUP+ scan** | `SwingTradingScanner` + ETF universe | **No ETF universe** in v2 |
| **Swing Auto panel** | `SwingAutoScreener::getSnapshot()` | `getSwingAutoSnapshotDurable()` ✅ |
| **Trading presets** | `TradingPreset::all()` (3 presets) | **Not ported** |
| **Morning checklist** | `routineSteps()` — 7 steps | **None** |
| **Alert banner** | `buildAlerts()` | **None** |
| **Dashboard** | Health N/A (separate) | System health + quick links only |

---

## Analyst workflow

PHP intended daily flow (`AppGuide` + `USER-GUIDE.md`):

```
Before market open
        │
        ▼
  Morning Routine          ← single cockpit
        │
        ├── Regime OK? → deploy % cap
        ├── Any EXIT alerts? → act first
        ├── Nifty 15m bias → intraday plan
        ├── ETF SETUP+ → rotation ideas
        └── Auto high conviction → swing watchlist
        │
        ▼
  Trading Presets          ← one-click paths (swing / ETF / intraday)
        │
        ▼
  Deep pages as needed     (positions, swing auto, screener)
```

**Rule:** Red alert banner means swing EXIT or intraday action required before scanning for new entries.

---

## Why the new architecture can be faster

### 1. Single JSON API vs heavy SSR

PHP `MorningDashboard::build()` runs synchronously on every page load:

- Regime fetch (NIFTYBEES daily)
- Nifty 15m chart fetch
- ETF universe scan (or cache read)
- Auto snapshot read
- All open positions tracked live

**Cold load:** 3–8s when ETF cache miss.

v2 planned: **one aggregated endpoint** with parallel panel fetches and per-panel cache TTLs.

### 2. Panel-level caching

| Panel | PHP cache | v2 planned |
|-------|-----------|--------------|
| ETF scan | `morning_dashboard/etf_scan` 10m | `sv:morning:etf` 10m |
| Regime | Via TA cache | `sv:regime:nifty` 15m ✅ |
| Auto radar | Swing auto snapshot | Redis + PostgreSQL ✅ |
| Nifty 15m | Yahoo intraday 90s | `sv:ta:intraday:*` ✅ |
| Positions | Live per request | Optional `?live=0` summary |

User gets **stale-while-revalidate**: show cached panels instantly, refresh heavy panels in background.

### 3. Skip ETF scan by default

ETF scan is the slowest panel (~50 symbols). Morning page should:

1. Return cached ETF panel if fresh (<10m)
2. Only run scan on explicit "Refresh ETF book" or worker pre-warm cron

### 4. Reuse existing v2 services

No duplicate logic — compose:

```
getSwingAutoState()     → auto panel
refreshOpenPositions()  → swing panel
currentMarketRegime()   → regime banner
intraday nifty state    → nifty card
```

### Latency budget (planned)

| Action | Target |
|--------|--------|
| `GET /morning` (all panels cached) | p95 < **300ms** |
| `GET /morning` (ETF cold) | p95 < **5s** (ETF async job) |
| `GET /morning?live=0` | p95 < **150ms** (no position live fetch) |
| First paint (skeleton UI) | < **100ms** |

---

## System architecture (planned)

```
┌──────────────┐  GET /api/v1/morning        ┌─────────────┐
│ MorningPage  │ ◄──────────────────────────►│   Fastify   │
│  /morning    │  POST .../morning/refresh   └──────┬──────┘
└──────────────┘         (ETF panel)                  │
                                                      ▼
                                           ┌──────────────────┐
                                           │ morning.ts       │
                                           │ buildMorning()   │
                                           └────────┬─────────┘
                                                    │
     ┌──────────────┬──────────────┬───────────────┼──────────────┬─────────────┐
     ▼              ▼              ▼               ▼              ▼             ▼
 nseSession    currentMarket   intraday/nifty   swing positions  etfScan    auto snapshot
 (new)         Regime ✅       state ✅         live ✅          (new)      durable ✅
                                                    │
                                              intraday positions
                                              (when NP built)
```

### v2 building blocks today

| Block | Package / service | Used by morning? |
|-------|-------------------|------------------|
| `currentMarketRegime()` | `@sv/data-adapters` | Partial (auto only) |
| `regimeGuidance()` | `@sv/swing` | Via `buildState()` |
| `getSwingAutoSnapshotDurable()` | `@sv/data-adapters` | Could power auto panel |
| `refreshOpenPositions()` | `swing-auto.ts` | Could power swing panel |
| `GET /intraday/nifty/state` | API + `@sv/intraday` | Separate page today |
| NSE session clock | — | **Missing** |
| ETF universe scan | — | **Missing** |
| Nifty positions tracker | — | **Missing** |

---

## Data aggregation

### PHP `MorningDashboard::build($refreshEtf)`

```php
$session  = PriceFreshness::nseSession();
$regime   = SwingMarketRegime::current($ta);
$guidance = SwingAutoDecision::regimeGuidance($regime);
$nifty    = Nifty15mDirection::analyze($chart15, '15m');
$etf      = self::etfPanel($ta, $refreshEtf);
$auto     = self::autoRadarPanel();
$swing    = self::swingPositionsPanel($ta);
$intraday = self::intradayPositionsPanel();
$alerts   = self::buildAlerts($swing, $intraday);
$routine  = self::routineSteps($session, $swing, $intraday, $etf, $auto);
```

Returns single array: `built_at`, `session`, `regime`, `guidance`, `nifty`, `etf`, `auto`, `swing`, `intraday`, `alerts`, `routine`.

### v2 today (fragmented)

User must visit 4+ pages:

| Need | v2 route / API |
|------|----------------|
| Regime + auto tiers | `/swing/auto` → `GET /api/v1/swing/auto/state` |
| Swing positions | `/positions` → `GET /api/v1/swing/positions?live=1` |
| Nifty direction | `/intraday` → `GET /api/v1/intraday/nifty/state` |
| Screener / verify | `/screener`, `/verify` |
| System health | `/` Dashboard |

---

## Morning checklist

`MorningDashboard::routineSteps()` — 7 linked steps:

| # | Step | Status logic | Link (PHP) |
|---|------|--------------|------------|
| 1 | Check NSE session | `ok` if market open | `morning-dashboard.php` |
| 2 | Swing regime (NIFTYBEES) | always `info` | `swing-trading.php?symbol=NIFTYBEES` |
| 3 | Review open swing positions | `warn` if EXIT count > 0 | `swing-positions.php` |
| 4 | Nifty 15m direction | `info` | `nifty-15m.php` |
| 5 | Intraday positions | `warn` if exit signals | `nifty-positions.php` |
| 6 | ETF SETUP+ book | `ok` if hits > 0 | `swing-trading.php?mode=etf` |
| 7 | Swing Auto high conviction | `ok` if snapshot + hits | `swing-auto-screener.php` |

Each step: `{ step, detail, href, status }` where `status` ∈ `ok` | `warn` | `info` | `muted`.

### v2 planned

Render as `MorningChecklist.tsx` from `routine` array in API response. Map PHP hrefs to React routes:

| PHP | v2 route |
|-----|----------|
| `swing-positions.php` | `/positions` |
| `nifty-15m.php` | `/intraday` |
| `nifty-positions.php` | `/nifty/positions` (planned) |
| `swing-auto-screener.php` | `/swing/auto` |
| `swing-trading.php?mode=etf` | `/swing?mode=etf` (planned) |

---

## UI panels

### Regime banner (hero)

PHP displays:

- Guidance title + tone (`success` / `warning` / `danger`)
- Regime label + NIFTYBEES proxy + EOD date
- Guidance message (deploy cap text)
- KPIs: 20d %, 60d %, deploy %, high-vol flag

v2 equivalent data exists in `getSwingAutoState()` → `regime` + `guidance` on Auto Radar page — not on Dashboard.

### Nifty intraday card

PHP fields: `label`, `tone`, `summary`, `price`, `confidence`, `setup_grade`, `entry_window`, `as_of`, `instrument_label`.

Source: `Nifty15mDirection::analyze()` — v2 port in `@sv/intraday/nifty-direction.ts` exposed via intraday state API.

### Swing positions card

Top `TOP_HITS` (5) rows + portfolio summary from `SwingTradePnl::summarizeOpen()`.

v2: `refreshOpenPositions()` returns `exit_verdict`, `gain_pct`, `exit_triggers` — sufficient for panel.

### Intraday positions card

PHP: `NiftyIntradayPositionTracker::trackOpen()` — action labels (`EXIT_NOW`, `CUT_LOSS`, …).

v2: **blocked** until [NIFTY-POSITIONS.md](NIFTY-POSITIONS.md) ships. Morning page should hide or show "Not configured" placeholder.

### ETF SETUP+ card

PHP: scans `SwingEtfUniverse` with `min_verdict: SETUP_PLUS`, caches 10m.

Columns: symbol, name, underlying, TER %, verdict, price, low-liquidity flag, stale flag.

v2: **no `SwingEtfUniverse` port**. Requires ETF metadata table or static config + swing scan endpoint.

### Swing Auto card

Top 5 from `tiers.high_conviction` in snapshot.

Fields: symbol, decision_label, decision_score, strict_verdict, price.

v2: `getSwingAutoState()` → `tiers.high_conviction` — **ready to wire**.

---

## Trading presets

PHP `TradingPreset` — three bookmarkable profiles. **Full doc:** [TRADING-PRESETS.md](TRADING-PRESETS.md).

| ID | Label | Primary action |
|----|-------|----------------|
| `conservative_swing` | Conservative swing | Tier-A ENTER + GC9 scan |
| `etf_rotation` | ETF rotation | Index + sector ETF SETUP+ |
| `intraday_session` | Intraday session | 5m trend scalp / 15m precision |

Rendered as chips at top of morning page + full page `trading-presets.php`.

### v2

**Not ported.** Planned: `packages/swing/src/trading-presets.ts`, `/presets`, morning chips (TP-E).

---

## Alerts

`buildAlerts($swing, $intraday)`:

1. Count summary: "N swing position(s) triggered EXIT rules"
2. Count summary: "N intraday position(s) need action"
3. Per-symbol urgent rows with trigger names

Rendered as red `Action required` banner above grid.

### v2 planned

```typescript
alerts: string[]  // same shape as PHP
urgent: {
  swing: Array<{ symbol, gain_pct, triggers }>;
  intraday: Array<{ label, action }>;
}
```

Derive from `refreshOpenPositions()` where `exit_verdict === 'EXIT'`.

---

## Cache layers

### PHP

| Source | Key | TTL |
|--------|-----|-----|
| `morning_dashboard` | `etf_scan` | 600s (10m) |
| Swing auto snapshot | file/Redis | 5m refresh cycle |
| Yahoo intraday | `ta/intraday:*` | ~90s |
| Stock/regime | `ta/closes:NIFTYBEES` | 24h |

### v2 planned

| Key | TTL | Panel |
|-----|-----|-------|
| `sv:morning:bundle` | 60s | Full aggregated response (optional) |
| `sv:morning:etf` | 600s | ETF panel |
| `sv:regime:nifty` | 900s | Regime ✅ |
| Swing auto snapshot | Redis + DB | Auto panel ✅ |
| `sv:ta:intraday:nifty50:15m` | ~90s | Nifty card ✅ |

**Refresh ETF:** `POST /api/v1/morning/refresh-etf` or `?refresh_etf=1` — bypasses ETF cache only.

---

## API mapping (PHP → v2)

| PHP | Planned v2 |
|-----|------------|
| GET `morning-dashboard.php` | `GET /api/v1/morning` |
| GET `?refresh_etf=1` | `GET /api/v1/morning?refresh_etf=1` |
| — | `GET /api/v1/morning?live=0` (skip position live fetch) |
| — | `GET /api/v1/morning/routine` (checklist only, fast) |

### Proposed response shape

```json
{
  "built_at": "2026-07-02T08:45:00+05:30",
  "session": {
    "phase": "open",
    "label": "Market open",
    "message": "NSE equity session active"
  },
  "regime": { "label": "Bull", "proxy": "NIFTYBEES", "return_20d_pct": 4.2 },
  "guidance": { "title": "Deploy bias", "tone": "success", "deploy_pct": 100, "message": "..." },
  "nifty": { "ok": true, "label": "Mild up", "confidence": 62, "href": "/intraday" },
  "swing": { "open": 3, "exit_count": 1, "portfolio": { "net_pnl": 12500 }, "rows": [] },
  "intraday": { "open": 0, "exit_count": 0, "rows": [], "available": false },
  "etf": { "hits": [], "hit_count": 0, "from_cache": true, "cached_ago": "4m ago" },
  "auto": { "available": true, "hits": [], "hit_count": 12, "saved_ago": "2m ago" },
  "alerts": ["1 swing position(s) triggered EXIT rules"],
  "routine": [{ "step": "...", "detail": "...", "href": "/positions", "status": "warn" }]
}
```

---

## Parity matrix

| Feature | PHP | v2 | Gap |
|---------|-----|-----|-----|
| Morning page/route | ✓ | ✗ | **MR-A** |
| Aggregated API | ✗ (SSR) | planned | v2 improvement |
| NSE session banner | ✓ | ✗ | **MR-A** |
| Regime + guidance hero | ✓ | partial (auto page) | **MR-A** |
| Morning checklist (7 steps) | ✓ | ✗ | **MR-A** |
| Action alerts banner | ✓ | ✗ | **MR-B** |
| Nifty 15m card | ✓ | partial (`/intraday`) | **MR-B** |
| Swing positions top 5 | ✓ | partial (`?live=1`) | **MR-B** |
| Intraday positions panel | ✓ | ✗ | **MR-C** (needs Nifty Positions) |
| ETF SETUP+ scan | ✓ | ✗ | **MR-D** |
| Swing Auto top 5 | ✓ | partial (auto page) | **MR-B** |
| Trading preset chips | ✓ | ✗ | **MR-E** |
| Refresh ETF button | ✓ | ✗ | **MR-D** |
| ETF cache 10m | ✓ | ✗ | **MR-D** |
| `validate-logic` tests | ✓ | ✗ | **MR-F** |
| Worker pre-warm cron | optional | planned | **MR-F** |

---

## Speed optimization plan

### Phase MR-A — API shell + checklist (2–3 days)

| # | Task |
|---|------|
| MR-A1 | `GET /api/v1/morning` — regime + auto + routine (no ETF, no live positions) |
| MR-A2 | Port `PriceFreshness::nseSession()` → `@sv/shared/nse-session.ts` |
| MR-A3 | `MorningPage.tsx` at `/morning` — regime hero + checklist |
| MR-A4 | Nav item "Morning" + Dashboard link |
| MR-A5 | `routineSteps()` port in `@sv/swing/morning-routine.ts` |

### Phase MR-B — Position & nifty panels (2–3 days)

| # | Task |
|---|------|
| MR-B1 | Wire swing panel via `refreshOpenPositions()` (`?live=1` default) |
| MR-B2 | `?live=0` fast path — DB positions only, no Yahoo |
| MR-B3 | Nifty card from intraday state (15m, cached) |
| MR-B4 | `buildAlerts()` + red banner component |
| MR-B5 | Auto panel top 5 from `getSwingAutoSnapshotDurable()` |

### Phase MR-C — Intraday positions (depends on Nifty Positions)

| # | Task |
|---|------|
| MR-C1 | Intraday panel when `nifty_positions` table exists |
| MR-C2 | Checklist step 5 live warn status |
| MR-C3 | Cross-link to `/nifty/positions` |

### Phase MR-D — ETF book (3–4 days)

| # | Task |
|---|------|
| MR-D1 | Port `SwingEtfUniverse` metadata (static JSON or DB) |
| MR-D2 | `etfPanel()` — swing scan ETF universe SETUP+ |
| MR-D3 | `sv:morning:etf` cache 10m |
| MR-D4 | Refresh ETF button + API flag |
| MR-D5 | ETF card UI (TER, liquidity, stale) |

### Phase MR-E — Trading presets (1–2 days)

See **[TRADING-PRESETS.md](TRADING-PRESETS.md)** (TP-A through TP-F) for full hub, deep links, and universe dependencies.

| # | Task |
|---|------|
| MR-E1 | Port `TradingPreset` → `@sv/swing/trading-presets.ts` |
| MR-E2 | Preset chips on Morning page |
| MR-E3 | `/presets` hub page |

### Phase MR-F — Ops & pre-warm (1–2 days)

| # | Task |
|---|------|
| MR-F1 | Worker cron: warm `sv:morning:etf` + regime before 9:00 IST |
| MR-F2 | Port `testMorningDashboard()` from `validate-logic.php` |
| MR-F3 | Stale-while-revalidate: return cached bundle, refresh ETF async |
| MR-F4 | Optional webhook when `exit_count > 0` |

### Acceptance criteria

- [ ] `/morning` loads actionable summary without visiting 4 other pages
- [ ] Cached morning API p95 < **300ms**
- [ ] Checklist step 3 shows `warn` when any swing EXIT
- [ ] Regime banner matches `/swing/auto` regime data
- [ ] ETF refresh completes < **8s** for full ETF universe
- [ ] `validate-logic` morning tests pass in vitest

---

## Implementation phases

```
Now — Dashboard health only; data scattered across pages
  │
  ├─► MR-A: /morning route + session + checklist + regime hero
  │
  ├─► MR-B: Swing + nifty + auto panels + alerts
  │
  ├─► MR-C: Intraday positions (after Nifty Positions NP-A)
  │
  ├─► MR-D: ETF universe + SETUP+ scan + cache
  │
  ├─► MR-E: Trading presets chips
  │
  └─► MR-F: Pre-warm cron + parity tests
```

**Milestone:** Maps to **M10** in [MILESTONES.md](MILESTONES.md) (Morning dashboard portion; LTG auto is separate track).

**Dependency note:** MR-C blocked on [NIFTY-POSITIONS.md](NIFTY-POSITIONS.md). MR-A/B can ship first with intraday panel placeholder.

---

## File reference

### Script Screener (v2) — existing (composable)

```
packages/data-adapters/src/market-regime.ts     currentMarketRegime
packages/data-adapters/src/auto-swing-scan.ts   getSwingAutoSnapshotDurable
packages/swing/src/auto-decision.ts             regimeGuidance
packages/swing/src/auto-screener.ts             buildState
apps/api/src/services/swing-auto.ts             getSwingAutoState, refreshOpenPositions
apps/api/src/server.ts                          /swing/auto/state, /intraday/nifty/state
apps/web/src/pages/DashboardPage.tsx            health only
apps/web/src/pages/SwingAutoPage.tsx            regime + tiers (partial morning)
```

### Script Screener (v2) — planned

```
packages/shared/src/nse-session.ts
packages/swing/src/morning-routine.ts
packages/swing/src/trading-presets.ts
packages/swing/src/etf-universe.ts
apps/api/src/services/morning.ts
apps/web/src/pages/MorningPage.tsx
apps/web/src/components/morning/*
```

### PHP reference (stock-verifier)

```
morning-dashboard.php
includes/MorningDashboard.php
includes/PriceFreshness.php
includes/TradingPreset.php
includes/SwingEtfUniverse.php
includes/SwingPositionTracker.php
includes/NiftyIntradayPositionTracker.php
includes/Nifty15mDirection.php
trading-presets.php
validate-logic.php                  testMorningDashboard()
includes/AppGuide.php               morning_dashboard context
```

---

## Related docs

- [Trading Presets](TRADING-PRESETS.md) — quick-launch chips on morning page
- [Swing Auto](SWING-AUTO.md) — auto radar panel + regime source
- [Swing Positions](SWING-POSITIONS.md) — swing panel + EXIT alerts
- [Nifty Intraday](INTRADAY.md) — Nifty 15m card data
- [Nifty Positions](NIFTY-POSITIONS.md) — intraday ledger panel (blocker)
- [Roadmap Phase 10](ROADMAP.md) — M10 morning dashboard
- [Development Milestones](MILESTONES.md) — M10 acceptance criteria
- [Web UI](WEB-UI.md) — routes
