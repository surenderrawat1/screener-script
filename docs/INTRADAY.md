# Nifty Intraday (5m / 15m) & Intraday App — Architecture & Speed Plan

**Nifty Intraday** analyzes Nifty 50 on **5-minute** and **15-minute** charts: direction, MTF confluence, 14 entry presets, trade plan, and live playbook. The PHP **Intraday App** (`intraday-app.php`) is a mobile PWA for the same workflow with scalp gate and position logging.

ETF radar chips come from **Admin → Data → ETF list** (`config/etfs.yaml`, tick Radar). Type any NSE/BSE ticker, ETF, or index (`TCS`, `NIFTYBEES`, `SUNPHARMA`, `INFY.BO`, `^NSEI`) into the radar — unknown names are synthesized as spot-only instruments. Catalog tabs stay as shortcuts.

Script Screener has ported the **analysis engine** to `@sv/intraday` with Redis-cached Yahoo charts. The **full trading UI** (charts, multi-instrument, scalp setup, PWA) remains largely on the PHP side.

> **PHP vs v2:** Use the old PHP project to *add* missing capability or stricter gates. Do not replace a v2 default, preset, or workflow with an older/looser PHP equivalent.

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
8. [14 entry presets](#14-entry-presets)
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
| **14 presets** | Entry gate profiles (baseline → cfa_precision + 20 MA Stratzy) |
| **Signal quality** | Grade A/B/C on active timeframe setup |
| **Live playbook** | Step-by-step session actions |
| **60s refresh** | Poll during market hours |

---

## PHP page mapping

| PHP file | Purpose | v2 equivalent |
|----------|---------|---------------|
| `nifty-15m.php` | Desktop radar: charts, presets table, signals, positions block | `/intraday` |
| `intraday-app.php` | Mobile PWA: scalp gate, live positions, journal | `/intraday/app` |
| `intraday-manifest.php` + `intraday-sw.js` | PWA install + offline | `/intraday/app` manifest + SW |
| `nifty-15m-api.php` | JSON: `state`, `lite`, `positions`, `add_position` | `state`, `lite`, positions CRUD |
| `trading-presets.php` | Hub links to intraday session | `/presets` hub ✅ |
| `nifty-intraday-backtest.php` | 60d preset matrix backtest | `/intraday/backtest` + `POST /api/v1/intraday/backtests` |

**Note:** There is no `intraday.php` in PHP. `docs/MIGRATION.md` uses that name as a logical alias for the v2 `/intraday` route.

---

## PHP vs Script Screener

| Aspect | PHP | Script Screener |
|--------|-----|-----------------|
| **Analysis engine** | `Nifty15mDirection.php` + 12 includes | `@sv/intraday` package |
| **Instruments** | Nifty50, BankNifty, Sensex, FinNifty, stocks | Nifty, Bank Nifty, Sensex, Fin Nifty + 12 liquid stocks |
| **Charts** | Lightweight Charts in browser (full OHLC) | ✓ Lightweight Charts via `GET /api/v1/intraday/chart/:instrument` + `IntradayPriceChart` (candles + SMA-9/20/50/200) |
| **Chart cache** | SQLite 90s/120s | Redis `sv:ta:intraday:nifty50:{5m\|15m}` with runtime `intraday_chart` TTL |
| **Dual fetch** | Often sequential in page | `Promise.all` 5m + 15m |
| **Scalp setup** | `NiftyIntradayScalpSetup.php` | `buildScalpSetup()` + `/intraday` banner |
| **Preset table UI** | 13-row pass/fail per TF | `IntradayPresetTable` on `/intraday` ✅ |
| **Instrument presets** | BankNifty → `strict_mtf`; Sensex → `production` | **v2 keeps** Bank/Fin → `banknifty_tuned`; Nifty/Sensex/stocks → `cfa_precision`; stock floors are additive |
| **Intraday positions** | JSON ledger + APIs | PostgreSQL ledger — [NIFTY-POSITIONS.md](NIFTY-POSITIONS.md) ✅ |
| **Backtest** | Full matrix UI | `/intraday/backtest` combo_compare matrix ✅ |
| **Tests** | `validate-logic.php` | `@sv/intraday` vitest (parity + instrument presets) |

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
5. Cache with TTL from `data-policy.yaml` (`intraday_chart`, default **300s**)

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

## 14 entry presets

**File:** `packages/intraday/src/entry-filter.ts`  
**Test:** `presetIds().length === 14`

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
| `ma20_stratzy` | SMA-20 bias · ≤0.45% from MA · MTF ≥55% · 15m SMA-20 · after 10:15 · 1 trade/day · **stratzy_trend 55/30/15** exits |

`evaluatePresets(analysis5, analysis15, mtf, instrument, interval)` returns pass/fail per preset for both TFs and marks the live recommended row.

`presetOptionsForInstrument(id, instrument)` adds **stricter stock floors** from PHP (`min_mtf_deploy ≥ 60`, actionable trigger, grade ≥ B, skip chop, 1 trade/session) via `max()` on numeric gates. Index products keep v2 preset defaults — PHP `strict_mtf` / `production` are not used as Bank/Sensex recommendations.

15m v2 defaults: Nifty / Sensex / stocks → `cfa_precision`, Bank Nifty / Fin Nifty → `banknifty_tuned`. 5m → `trend_scalp_5m`. `pickLiveRecommendedPreset()` keeps that default when it passes the active TF, otherwise the first passing row on `quality` → `strict_mtf` → `banknifty_tuned` → `production` → `cfa_precision` → `baseline`.

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
| `GET ?action=lite` | `GET /api/v1/intraday/nifty/lite` |
| `GET ?action=positions` | `GET /api/v1/intraday/positions?status=open&live=1` |
| `POST add_position` | `POST /api/v1/intraday/positions` |
| `POST close_position` | `POST /api/v1/intraday/positions/:id/close` |

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

**Shipped on `/intraday` (parity with PHP `nifty-15m.php`):**
- Candlestick chart — `IntradayPriceChart` (Lightweight Charts, lazy OHLC)
- Preset evaluation table — `IntradayPresetTable` (13+ rows, 5m/15m)
- Scalp setup gate — `IntradayScalpSetupCard`
- Trade plan cards — spot + F&O panels with entry/stop/T1–T3
- Multi-instrument tabs — indices, stocks, ETFs, free-text symbol
- Open positions block — live 60s poll (independent of radar refresh)
- Direction signals panel — `IntradaySignalsPanel` (KPI strip + bull/bear signal list + trigger line; PHP `#n15-signals`)

**Still lighter vs PHP:**
- Trigger history log (persisted trigger state over time — PHP also lacks this; only live trigger is shown)

### PHP `intraday-app.php` (mobile PWA)

**Shipped (v2 ahead of PHP):**
- `/intraday/app` + `GET /api/v1/intraday/nifty/lite`
- Any stock/ETF/index (not Nifty-only)
- 14:30 IST flatten banner
- Installable manifest + service worker

---

## Parity matrix

| Feature | PHP | v2 | Gap |
|---------|-----|-----|-----|
| 5m/15m direction engine | ✓ | ✓ tested | — |
| 14 presets | ✓ | ✓ tested | — |
| MTF confluence | ✓ | ✓ | — |
| Live playbook | ✓ | ✓ | — |
| Yahoo + cache TTL | ✓ | ✓ | — |
| Parallel 5m+15m fetch | partial | ✓ | v2 faster cold fetch |
| Chart UI | ✓ | ✓ | `IntradayPriceChart` (candles + SMA overlays, 5m/15m) |
| Preset table UI | ✓ | ✓ | `IntradayPresetTable` |
| Scalp setup | ✓ | ✓ | `IntradayScalpSetupCard` |
| Direction signals | ✓ | ✓ | `IntradaySignalsPanel` on `/intraday` |
| Multi-instrument | ✓ | ✓ | Nifty, Bank Nifty, Sensex, Fin Nifty + 12 stocks |
| Stock F&O plans | ✓ | ✓ partial | 7 liquid names; NSE monthly last Tuesday |
| Intraday App PWA | ✓ | ✓ | `/intraday/app` + manifest |
| Instrument-aware preset | ✓ | ✓ | `recommended_preset` + stock floors |
| Intraday positions | ✓ | ✓ | [NIFTY-POSITIONS.md](NIFTY-POSITIONS.md) |
| Backtest matrix | ✓ | ✓ | `/intraday/backtest` |
| `lite` API | ✓ | ✓ | I-D1 any-symbol |

---

## Speed optimization plan

### Phase I-A — Fast state (1–2 days)

| # | Task | Target |
|---|------|--------|
| I-A1 | Redis snapshot `sv:intraday:nifty:state` TTL 60s | **Shipped** — `sv:intraday:state:{id}:{tf}:{gate}` TTL 60s |
| I-A2 | Split `GET .../chart?interval=5m` for OHLC (lazy load) | **Shipped** — state has bar counts only; OHLC via `/chart/:instrument` |
| I-A3 | `?refresh=1` only bypasses chart cache, not full recompute path | **Shipped** — refresh busts 5m/15m session charts + snapshot; 60d accuracy gate stays on chart TTL |

### Phase I-B — Analysis parity (2–3 days)

| # | Task |
|---|------|
| I-B1 | Port `NiftyIntradayScalpSetup` → `@sv/intraday/scalp-setup.ts` | **Shipped** |
| I-B2 | `presetOptionsForInstrument()` for future multi-instrument | **Shipped** — stock floors + `max()` merge |
| I-B3 | Dynamic `recommended_preset` from MTF + session (not hardcoded) | **Shipped** — `pickLiveRecommendedPreset` |

### Phase I-C — Radar UI (3–5 days)

| # | Task |
|---|------|
| I-C1 | Lightweight Charts component (lazy fetch bars endpoint) | **Shipped** |
| I-C2 | Preset pass/fail table (5m + 15m columns) | **Shipped** |
| I-C3 | Trade plan card (entry, stop, targets) | **Shipped** |
| I-C4 | Scalp gate banner when 5m active | **Shipped** |

### Phase I-D — Intraday App & instruments (5+ days)

| # | Task |
|---|------|
| I-D1 | `GET /intraday/nifty/lite` PWA payload | **Shipped** — any instrument + journal + 14:30 flatten |
| I-D2 | `IntradayInstrument` resolver — BankNifty, Sensex, FinNifty, liquid stocks | **Shipped** — plus free-text synthesize |
| I-D3 | Mobile layout route `/intraday/app` | **Shipped** |
| I-D4 | Service worker static cache (optional) | **Shipped** — installability SW (no hashed-asset cache) |

### Acceptance criteria

- [ ] Cached state API p95 < **200ms**
- [ ] Cold Yahoo refresh p95 < **3s** (both TFs)
- [ ] Chart loads in second request < **500ms** cached
- [ ] Playbook + preset_eval match PHP fixture tests
- [ ] 5m/15m toggle updates primary analysis without full duplicate fetch

---

## High-Accuracy Gate — More Than 70% Profitable Trades

Intraday live eligibility still requires the recommended preset to satisfy both:

- **Win rate > 70%** (strictly greater, not equal)
- **At least 10 simulated trades** over the 60-day backtest

The gate is calculated in `intraday-backtest.ts` and returned on every preset as:

- `accuracy_status`: `pass`, `fail`, `unproven`, or `missing`
- `accuracy_pass`
- `accuracy_floor_pct`
- `min_trades_required`

### Economic ranking (matrix / Stratzy proof)

The combo matrix no longer scores T1-only (+1R/−1R). Simulation uses the live book:

- **Partials:** preset exit profile (Stratzy `55/30/15` @1R/2R/3R)
- **After T1:** stop ratchets to breakeven
- **Paper execution:** worker books **PARTIAL_T1 → PARTIAL_T2 → EXIT_TARGET (T3)** on live bars (high/low), not suggest-only

**Paper DB:** `paper_positions` tracks `remaining_pct`, `t1_booked`, `t2_booked`, `breakeven_armed`, `original_qty`. Run `pnpm --filter @sv/db exec prisma db push` after pull.

- **Partials:** 40% @1R (T1), 40% @2R (T2), 20% @3R (T3)
- **After T1:** stop ratchets to breakeven
- **Win% (Stratzy / accuracy gate):** classic **T1-only** (+1R/−1R) — same yardstick as before the scaled-exit upgrade (historically often mid-40%s on Nifty/BankNifty)
- **Scaled WR:** full 40/40/20 book before costs (runners can give back a T1 win → lower WR)
- **Net WR / Net E:** after ~5 bps/side + ₹45 RT on ₹30,000 notional
- **Economic pass:** net E > 0.1R and profit factor ≥ 1.25 (≥10 trades)
- **Rank order:** economic pass → net E → PF → Stratzy WR gate

- **Exit profiles are live:** preset `exit_profile` now drives T1/T2/T3 weights in BT + playbook (`stratzy_trend` = 55/30/15 @1/2/3R).
- **Stratzy entries tightened:** MTF ≥55%, 15m SMA-20 agreement, no SMA chase (>0.45%), actionable trigger, 1 trade/session.

The live state API runs the recommended preset against cached 60-day 5m/15m charts. `buildLivePlaybook()` sets `actionable: false` when the preset fails, has fewer than 10 trades, or has no historical evidence. The UI shows **LIVE ELIGIBLE** or **BLOCKED**.

### Live validation — 3 August 2026 (classic T1-only sample)

| Instrument / TF | Best proven preset | Trades | Win rate | >70% status |
|-----------------|--------------------|--------|----------|-------------|
| Nifty 50 · 5m | Trend scalp | 36 | 55.6% | Fail |
| Nifty 50 · 15m | Baseline | 116 | 41.4% | Fail |
| Bank Nifty · 5m | Trend scalp | 34 | 52.9% | Fail |
| Bank Nifty · 15m | Baseline | 116 | 44.8% | Fail |

**Interpretation:** No tested preset cleared the >70% WR threshold under the old payoff model. Re-run the matrix after the scaled-exit upgrade before claiming economic pass. The WR gate remains an evidence gate, not a guarantee of future profitability.

---

## File reference

### Script Screener (v2)

```
packages/intraday/src/
  nifty-direction.ts      analyzeNiftyDirection
  entry-filter.ts         14 presets, evaluatePresets
  mtf.ts                  mtfConfluence
  live-playbook.ts        buildLivePlaybook
  trade-plan.ts           plan helpers
  session-regime.ts       session-clock.ts
  signal-quality.ts       gradeSignalQuality
  ema50-bias.ts           gc9-dc9.ts
  intraday-backtest.ts    >70% accuracy gate + 60d preset matrix

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
pnpm --filter @sv/intraday test   # 35 tests
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
