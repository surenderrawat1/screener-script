# Nifty Intraday (5m / 15m) & Intraday App — Architecture & Speed Plan

**Nifty Intraday** analyzes Nifty 50 on **5-minute** and **15-minute** charts: direction, MTF confluence, 13 entry presets, trade plan, and live playbook. The PHP **Intraday App** (`intraday-app.php`) is a mobile PWA for the same workflow with scalp gate and position logging.

Script Screener has ported the **analysis engine** to `@sv/intraday` with Redis-cached Yahoo charts. The **full trading UI** (charts, multi-instrument, scalp setup, PWA) remains largely on the PHP side.

> Intraday **positions** (same-day index trades) are documented separately in [NIFTY-POSITIONS.md](NIFTY-POSITIONS.md). They are **not** the same as [Swing Positions](SWING-POSITIONS.md).

---

## Table of contents

1. [What it does](#what-it-does)
2. [PHP page mapping](#php-page-mapping)
3. [PHP vs Script Screener](#php-vs-script-screener)
4. [NIFTYBEES vs Nifty 50](#niftybees-vs-nifty-50)
5. [System architecture](#system-architecture)
6. [5m / 15m chart pipeline](#5m--15m-chart-pipeline)
7. [Analysis engine](#analysis-engine)
8. [13 entry presets](#13-entry-presets)
9. [Live playbook](#live-playbook)
10. [API mapping](#api-mapping)
11. [UI surfaces](#ui-surfaces)
12. [Parity matrix](#parity-matrix)
13. [Speed optimization plan](#speed-optimization-plan)
14. [File reference](#file-reference)

---

## What it does

| Capability | Description |
|------------|-------------|
| **Dual timeframe** | Parallel 5m + 15m Yahoo intraday bars |
| **Direction** | Bias, confidence, structure, chop detection |
| **MTF confluence** | 5m + 15m alignment score and deploy % |
| **Trade plan** | Entry zone, stop, T1/T2/T3, R:R |
| **13 presets** | Entry gate profiles (baseline → cfa_precision) |
| **Signal quality** | Grade A/B/C on active timeframe setup |
| **Live playbook** | Step-by-step session actions |
| **60s refresh** | Poll during market hours |

---

## PHP page mapping

| PHP file | Purpose | v2 equivalent |
|----------|---------|---------------|
| `nifty-15m.php` | Desktop radar: charts, presets table, signals, positions block | `/intraday` (partial) |
| `intraday-app.php` | Mobile PWA: scalp gate, live positions, journal | **Not ported** |
| `intraday-manifest.php` + `intraday-sw.js` | PWA install + offline | **Not ported** |
| `nifty-15m-api.php` | JSON: `state`, `lite`, `positions`, `add_position` | `GET /api/v1/intraday/nifty/state` only |
| `trading-presets.php` | Hub links to intraday session | **Not ported** — [TRADING-PRESETS.md](TRADING-PRESETS.md) |
| `nifty-intraday-backtest.php` | 60d preset matrix backtest | Phase 12 roadmap |

**Note:** There is no `intraday.php` in PHP. `docs/MIGRATION.md` uses that name as a logical alias for the v2 `/intraday` route.

---

## PHP vs Script Screener

| Aspect | PHP | Script Screener |
|--------|-----|-----------------|
| **Analysis engine** | `Nifty15mDirection.php` + 12 includes | `@sv/intraday` package |
| **Instruments** | Nifty50, BankNifty, Sensex, FinNifty, stocks | **Indices + 12 liquid stocks**; F&O for indices + 7 stocks |
| **Charts** | Lightweight Charts in browser (full OHLC) | ✓ Lightweight Charts via `GET /api/v1/intraday/chart/:instrument` + `IntradayPriceChart` (candles + SMA-9/20/50/200) |
| **Chart cache** | SQLite 90s/120s | Redis `sv:ta:intraday:nifty50:{5m\|15m}` |
| **Dual fetch** | Often sequential in page | `Promise.all` 5m + 15m |
| **Scalp setup** | `NiftyIntradayScalpSetup.php` | **Not ported** |
| **Preset table UI** | 13-row pass/fail per TF | `preset_eval` in API; **UI not shown** |
| **Instrument presets** | BankNifty → `banknifty_tuned` | Hardcoded `cfa_precision` |
| **Intraday positions** | JSON ledger + APIs | See [NIFTY-POSITIONS.md](NIFTY-POSITIONS.md) |
| **Backtest** | Full matrix UI | Phase 12 |
| **Tests** | `validate-logic.php` | 17 parity tests |

---

## NIFTYBEES vs Nifty 50

| Symbol | Role |
|--------|------|
| `^NSEI` | Primary Yahoo index chart |
| `NIFTYBEES.NS` | Fallback when `^NSEI` fails |
| NIFTYBEES (daily) | Swing **market regime** only — not intraday positions |

NIFTYBEES is a **price proxy**, not an intraday position instrument. Do not confuse with [Nifty Positions](NIFTY-POSITIONS.md) (index day trades) or [Swing Positions](SWING-POSITIONS.md) (multi-day equity swings).

---

## System architecture

```
┌──────────────┐  GET /intraday/nifty/state   ┌─────────────┐
│ IntradayPage │ ◄───────────────────────────►│   Fastify   │
│  /intraday   │  ?interval=5m|15m&refresh=1  └──────┬──────┘
└──────────────┘                                     │
                                                     ▼
                              ┌──────────────────────────────────┐
                              │ getNiftyIntradayState (intraday.ts)│
                              └──────────────┬───────────────────┘
                                             │
              ┌──────────────────────────────┼──────────────────────────────┐
              ▼                              ▼                              ▼
   ┌────────────────────┐          ┌─────────────────┐          ┌─────────────────┐
   │ fetchNiftyIntraday │          │   @sv/intraday  │          │     Redis       │
   │ Charts (parallel)  │─────────►│ analyzeDirection│          │ sv:ta:intraday  │
   │ intraday-chart.ts  │          │ mtf, presets,   │          │ :nifty50:5m/15m │
   └────────────────────┘          │ playbook        │          └─────────────────┘
                                   └─────────────────┘
```

---

## 5m / 15m chart pipeline

### Fetch (`packages/data-adapters/src/intraday-chart.ts`)

```
fetchNiftyIntradayCharts(refresh?)
  → Promise.all([ fetchIntradayChart('5m'), fetchIntradayChart('15m') ])
```

Per interval:

1. Check Redis `sv:ta:intraday:nifty50:{interval}` (unless `refresh=true`)
2. Try Yahoo `^NSEI` then `NIFTYBEES.NS`
3. Range: **5d**, interval: **5m** or **15m**
4. Parse timestamps → IST `time_label`
5. Cache with TTL: **90s** (5m), **120s** (15m) — matches PHP

### Response metadata (v2 API)

Bars are **not** sent to the web client (payload size). API includes:

```json
"chart_5m": { "bar_count": 312, "yahoo": "^NSEI" },
"chart_15m": { "bar_count": 104, "yahoo": "^NSEI" }
```

PHP sends full OHLC to Lightweight Charts in the browser.

### Active interval

Query `?interval=5m|15m` selects which analysis drives `analysis`, `plan`, and playbook primary TF. **Both** timeframes are always computed.

---

## Analysis engine

### `analyzeNiftyDirection(chart, interval)`

**File:** `packages/intraday/src/nifty-direction.ts`

Outputs (when `ok: true`):

| Field | Meaning |
|-------|---------|
| `bias` | `long` / `short` / `neutral` |
| `confidence` | 0–100 |
| `ltp` | Last traded price |
| `structure` | Trend structure label |
| `chop` | Chop regime flag |
| `trade_plan` | Entry, stop, targets, R:R |
| `session_regime` | Open drive, midday, etc. |
| `ema50_bias` | 5m EMA-50 alignment |
| `gc9_dc9` | Golden/death cross state |

### MTF (`mtfConfluence`)

Combines 5m + 15m analyses → `aligned`, `deploy_pct`, `label`.

### Signal quality (`gradeSignalQuality`)

Grades active setup: **A** / **B** / **C** with reasons.

---

## 13 entry presets

**File:** `packages/intraday/src/entry-filter.ts`  
**Test:** `presetIds().length === 13`

| ID | Label (summary) |
|----|-----------------|
| `baseline` | Directional only, no range fades |
| `quality` | EMA50 + GC9, conf ≥50, skip chop |
| `strict_mtf` | 5m+15m aligned, deploy ≥60% |
| `sniper` | MTF, conf ≥60, actionable trigger only |
| `trend_day` | Trend session, wider targets |
| `trend_scalp_5m` | 5m scalp in trend |
| `trend_mtf` | MTF trend follow |
| `after_or` | Post opening range |
| `after_or_mtf` | OR break + MTF |
| `analytics_tuned` | Backtest-tuned gates |
| `production` | Production profile |
| `banknifty_tuned` | BankNifty overrides (PHP applies per instrument) |
| `cfa_precision` | Strictest CFA gates — **v2 default recommended** |

`evaluatePresets(analysis5, analysis15, mtf)` returns pass/fail per preset for both TFs.

PHP `presetOptionsForInstrument()` applies BankNifty/Sensex overrides — **v2 uses single preset options only**.

---

## Live playbook

**Function:** `buildLivePlaybook(plan, analysis, analysis5, mtf, presetEval, recommendedPreset, activeIv)`

Returns:

- `headline`, `bias_label`, `tone`
- `steps[]` — numbered actions (wait, enter, trail, exit)
- `gate_status` — which presets pass on active TF
- `recommended_preset`

`IntradayPage` renders headline + steps. PHP also shows trade plan levels, scalp panel, and chart overlays.

---

## API mapping

### Script Screener

```http
GET /api/v1/intraday/nifty/state?interval=15m&refresh=0
```

| Query | Default | Purpose |
|-------|---------|---------|
| `interval` | `15m` | Active TF for primary `analysis` |
| `refresh` | `0` | `1` bypasses Redis chart cache |

**Auth:** JWT, permission `view_app`

### PHP `nifty-15m-api.php`

| Action | v2 |
|--------|-----|
| `GET ?action=state` | `GET /intraday/nifty/state` |
| `GET ?action=lite` | Not ported (PWA payload) |
| `GET ?action=positions` | Not ported → [NIFTY-POSITIONS.md](NIFTY-POSITIONS.md) |
| `POST add_position` | Not ported |
| `POST close_position` | Not ported |

### State response shape (v2)

```json
{
  "ok": true,
  "index": "nifty50",
  "interval": "15m",
  "refresh_sec": 60,
  "recommended_preset": "cfa_precision",
  "analysis": { ... },
  "analysis_5m": { ... },
  "analysis_15m": { ... },
  "mtf": { ... },
  "plan": { ... },
  "playbook": { "steps": [...] },
  "preset_eval": { ... },
  "server_time": "..."
}
```

---

## UI surfaces

### `/intraday` — `IntradayPage.tsx`

**Current:**
- 5m / 15m segmented toggle
- Refresh button (`refresh=1`)
- 60s auto-poll
- Headline, bias, LTP, direction, confidence, MTF
- Playbook steps list

**Missing vs PHP `nifty-15m.php`:**
- Candlestick chart (Lightweight Charts)
- Preset evaluation table (13 rows)
- Scalp setup gate panel
- Trade plan level cards (entry, stop, T1/T2/T3)
- Signal list / trigger history
- Instrument tabs (BankNifty, etc.)
- Intraday positions block

### PHP `intraday-app.php` (mobile PWA)

**Not in v2:**
- Installable PWA manifest + service worker
- `lite` API optimized payload
- Scalp gate full-screen UI
- Session journal
- Touch-optimized position cards

---

## Parity matrix

| Feature | PHP | v2 | Gap |
|---------|-----|-----|-----|
| 5m/15m direction engine | ✓ | ✓ tested | — |
| 13 presets | ✓ | ✓ tested | — |
| MTF confluence | ✓ | ✓ | — |
| Live playbook | ✓ | ✓ | — |
| Yahoo + cache TTL | ✓ | ✓ | — |
| Parallel 5m+15m fetch | partial | ✓ | v2 faster cold fetch |
| Chart UI | ✓ | ✓ | `IntradayPriceChart` (candles + SMA overlays, 5m/15m) |
| Preset table UI | ✓ | ✗ | Phase I-C |
| Scalp setup | ✓ | ✗ | Phase I-B |
| Multi-instrument | ✓ | ✓ partial | Sensex/FinNifty not yet |
| Stock F&O plans | ✓ | ✓ partial | 7 liquid names; monthly expiry |
| Intraday App PWA | ✓ | ✗ | Phase I-D |
| Instrument-aware preset | ✓ | ✗ | Phase I-B |
| Intraday positions | ✓ | ✗ | [NIFTY-POSITIONS.md](NIFTY-POSITIONS.md) |
| Backtest matrix | ✓ | ✗ | Phase 12 |
| `lite` API | ✓ | ✗ | Phase I-D |

---

## Speed optimization plan

### Phase I-A — Fast state (1–2 days)

| # | Task | Target |
|---|------|--------|
| I-A1 | Redis snapshot `sv:intraday:nifty:state` TTL 60s | p95 < **200ms** cached |
| I-A2 | Split `GET .../chart?interval=5m` for OHLC (lazy load) | Main state < **50KB** |
| I-A3 | `?refresh=1` only bypasses chart cache, not full recompute path | Predictable refresh cost |

### Phase I-B — Analysis parity (2–3 days)

| # | Task |
|---|------|
| I-B1 | Port `NiftyIntradayScalpSetup` → `@sv/intraday/scalp-setup.ts` |
| I-B2 | `presetOptionsForInstrument()` for future multi-instrument |
| I-B3 | Dynamic `recommended_preset` from MTF + session (not hardcoded) |

### Phase I-C — Radar UI (3–5 days)

| # | Task |
|---|------|
| I-C1 | Lightweight Charts component (lazy fetch bars endpoint) |
| I-C2 | Preset pass/fail table (5m + 15m columns) |
| I-C3 | Trade plan card (entry, stop, targets) |
| I-C4 | Scalp gate banner when 5m active |

### Phase I-D — Intraday App & instruments (5+ days)

| # | Task |
|---|------|
| I-D1 | `GET /intraday/nifty/lite` PWA payload |
| I-D2 | `IntradayInstrument` resolver — BankNifty, FinNifty, liquid stocks |
| I-D3 | Mobile layout route `/intraday/app` |
| I-D4 | Service worker static cache (optional) |

### Acceptance criteria

- [ ] Cached state API p95 < **200ms**
- [ ] Cold Yahoo refresh p95 < **3s** (both TFs)
- [ ] Chart loads in second request < **500ms** cached
- [ ] Playbook + preset_eval match PHP fixture tests
- [ ] 5m/15m toggle updates primary analysis without full duplicate fetch

---

## File reference

### Script Screener (v2)

```
packages/intraday/src/
  nifty-direction.ts      analyzeNiftyDirection
  entry-filter.ts         13 presets, evaluatePresets
  mtf.ts                  mtfConfluence
  live-playbook.ts        buildLivePlaybook
  trade-plan.ts           plan helpers
  session-regime.ts       session-clock.ts
  signal-quality.ts       gradeSignalQuality
  ema50-bias.ts           gc9-dc9.ts

packages/data-adapters/src/intraday-chart.ts
apps/api/src/services/intraday.ts
apps/web/src/pages/IntradayPage.tsx
```

### PHP reference

```
nifty-15m.php
intraday-app.php
nifty-15m-api.php
includes/Nifty15mDirection.php
includes/NiftyIntradayEntryFilter.php
includes/NiftyIntradayScalpSetup.php
includes/NiftyIntradayLivePlaybook.php
includes/IntradayInstrument.php
```

### Tests

```bash
pnpm --filter @sv/intraday test   # 17 tests
```

---

## Related docs

- [Morning Routine](MORNING-ROUTINE.md) — Nifty 15m card on morning dashboard
- [Trading Presets](TRADING-PRESETS.md) — intraday session preset (`trend_scalp_5m`)
- [Nifty Positions](NIFTY-POSITIONS.md) — intraday trade ledger (separate from swing)
- [Swing Auto](SWING-AUTO.md) — uses NIFTYBEES daily regime
- [API Reference](API.md)
- [Milestones M6–M7](MILESTONES.md)
- [Roadmap Phase 12](ROADMAP.md) — intraday backtest
