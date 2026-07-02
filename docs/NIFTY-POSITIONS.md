# Nifty Intraday Positions — Architecture & Speed Plan

**Nifty Positions** is the same-day **index and liquid stock intraday trade ledger** in PHP: log entries from the 5m/15m radar or mobile app, track live stops and targets (T1/T2/T3), and journal closed trades.

Script Screener has **not ported** this ledger. v2 has [Swing Positions](SWING-POSITIONS.md) (multi-day equity swings in PostgreSQL) and [Nifty Intraday analysis](INTRADAY.md) (5m/15m playbook only) — but no `nifty_intraday_positions` equivalent.

> **Do not confuse:** Nifty Positions ≠ Swing Positions ≠ NIFTYBEES regime proxy.

---

## Table of contents

1. [Three different “position” concepts](#three-different-position-concepts)
2. [What Nifty Positions does (PHP)](#what-nifty-positions-does-php)
3. [PHP vs Script Screener](#php-vs-script-screener)
4. [Data model](#data-model)
5. [Live tracking pipeline](#live-tracking-pipeline)
6. [Management actions](#management-actions)
7. [Integration with Nifty 5m/15m radar](#integration-with-nifty-5m15m-radar)
8. [Integration with Intraday App](#integration-with-intraday-app)
9. [API reference (PHP)](#api-reference-php)
10. [Planned v2 architecture](#planned-v2-architecture)
11. [Speed optimization plan](#speed-optimization-plan)
12. [Migration plan](#migration-plan)
13. [File reference](#file-reference)

---

## Three different “position” concepts

| Concept | PHP storage | v2 | Horizon |
|---------|-------------|-----|---------|
| **Nifty intraday positions** | `data/nifty_intraday_positions.json` | **Not built** | Same session / same day |
| **Swing positions** | `data/swing_positions.json` | PostgreSQL `swing_positions` | Multi-day swings |
| **NIFTYBEES proxy** | Yahoo symbol only | Chart/regime cache | Not a position — index price stand-in |

---

## What Nifty Positions does (PHP)

| Capability | Description |
|------------|-------------|
| **Log trades** | From radar trade plan, scalp setup, or manual levels |
| **Instruments** | Nifty50, BankNifty, Sensex, FinNifty, liquid stocks |
| **Levels** | Entry, stop, T1, T2, T3, quantity |
| **Live mark** | Yahoo quote vs plan levels |
| **Exit actions** | HOLD, PARTIAL_T1, PARTIAL_T2, EXIT_NOW, EXIT_TIME, TIGHTEN_STOP |
| **Session date** | Trades tied to trading session |
| **Sources** | `manual`, `nifty_radar_5m`, `nifty_radar_15m`, `nifty_scalp_5m`, `nifty_intraday_app` |
| **Journal** | Closed trades: win rate, avg R, CSV export |
| **60s poll** | `nifty-positions-api.php` + embedded in radar state |

---

## PHP vs Script Screener

| Aspect | PHP | Script Screener v2 |
|--------|-----|---------------------|
| **Storage** | JSON file | **No table** (planned `nifty_intraday_positions`) |
| **UI** | `nifty-positions.php` full CRUD + journal | **None** |
| **API** | `nifty-positions-api.php`, `nifty-15m-api.php` actions | **None** |
| **Live tracker** | `NiftyIntradayPositionTracker` | **None** |
| **Migration** | — | `migrate:php` does **not** import this file |
| **Swing positions** | Separate JSON | `/positions` — different product |

Users on v2 who need intraday position tracking must use PHP pages or wait for Phase NP (below).

---

## Data model

### PHP JSON (`data/nifty_intraday_positions.json`)

```json
{
  "updated_at": "2026-07-02T15:30:00+05:30",
  "positions": [
    {
      "id": "a1b2c3d4e5f67890",
      "instrument": "nifty50",
      "symbol": "NIFTY50",
      "status": "open",
      "side": "long",
      "entry_price": 24150.0,
      "entry_time": "2026-07-02T10:15:00+05:30",
      "session_date": "2026-07-02",
      "quantity": 50,
      "stop_loss": 24100.0,
      "target_1": 24200.0,
      "target_2": 24250.0,
      "target_3": 24300.0,
      "notes": "Radar 15m cfa_precision",
      "source": "nifty_radar_15m",
      "highest_since_entry": 24220.0,
      "trailed_stop": 24180.0,
      "closed_at": null,
      "closed_price": null,
      "closed_reason": null
    }
  ]
}
```

### Instrument IDs (`IntradayInstrument.php`)

| ID | Label |
|----|-------|
| `nifty50` | Nifty 50 |
| `banknifty` | Bank Nifty |
| `sensex` | Sensex |
| `niftyit` | Nifty IT |
| `finnifty` | Fin Nifty |
| `midcap100` | Midcap 100 |
| + liquid stocks | TCS, RELIANCE, HDFCBANK, … |

### Source tags (`NiftyIntradayPositionSource.php`)

| Source | Origin |
|--------|--------|
| `manual` | `nifty-positions.php` form |
| `nifty_radar_5m` | Log from 5m radar |
| `nifty_radar_15m` | Log from 15m radar |
| `nifty_scalp_5m` | Scalp setup panel |
| `nifty_intraday_app` | Mobile PWA |

---

## Live tracking pipeline

### PHP (`NiftyIntradayPositionTracker::evaluatePosition`)

```
1. Resolve instrument → Yahoo symbol
2. liveQuoteForSymbol() — intraday mark
3. Compare vs stop, T1, T2, T3, time rules
4. Session time stop (e.g. exit before close)
5. Return action + distances + P&L points
6. Optional: persist trailed_stop ratchet
```

### Evaluation outputs

| Field | Meaning |
|-------|---------|
| `current_price` | Live mark |
| `gain_points` / `gain_pct` | vs entry |
| `distance_to_stop` | Risk proximity |
| `distance_to_t1` | Target proximity |
| `exit_action` | Management action constant |
| `action_label` | Human label |
| `time_exit_warning` | Near session end |

Unlike swing X1–X9, intraday uses **target ladder** (T1/T2/T3) and **session time** heavily.

---

## Management actions

**PHP constants** (representative):

| Action | When |
|--------|------|
| `HOLD` | Within plan, no trigger |
| `PARTIAL_T1` | T1 reached — scale suggestion |
| `PARTIAL_T2` | T2 reached |
| `EXIT_NOW` | Stop hit or hard exit signal |
| `EXIT_TARGET` | Final target / plan complete |
| `EXIT_TIME` | Session time stop |
| `TIGHTEN_STOP` | Price near stop or trail rule |

Advisory only — user confirms close on `nifty-positions.php`.

---

## Integration with Nifty 5m/15m radar

### `nifty-15m.php` + `nifty-15m-api.php`

- State API includes open positions when `?positions=1` (default)
- Skip position refresh: `?positions=0` (faster state load — **pattern to copy in v2**)
- **Log trade** button → POST `add_position` with plan levels pre-filled
- Positions panel: live action labels synced with 60s poll

### Scalp setup (`NiftyIntradayScalpSetup`)

5m-only gate; logging source `nifty_scalp_5m`.

See [INTRADAY.md](INTRADAY.md) for analysis engine; positions are the **execution ledger** on top.

---

## Integration with Intraday App

**`intraday-app.php`** uses:

- `GET nifty-15m-api.php?action=lite` — compact payload: direction, scalp gate, positions, journal snippet
- POST `add_position` / `close_position` from mobile UI
- Source: `nifty_intraday_app`
- 60s refresh on positions block

v2 has no `lite` endpoint or PWA.

---

## API reference (PHP)

### `nifty-positions-api.php`

| Request | Purpose |
|---------|---------|
| `GET` (default) | Open positions with live eval |
| `GET ?refresh=1` | Force quote refresh |

### `nifty-15m-api.php` (position actions)

| Action | Method | Body |
|--------|--------|------|
| `positions` | GET | Tracked opens only |
| `add_position` | POST | instrument, side, entry, stops, targets, qty, source |
| `close_position` | POST | id, closed_price, reason |

### `nifty-positions.php` (page POST)

| action | Purpose |
|--------|---------|
| `add` | Manual new position |
| `close` | Close at price |
| `update` | Edit levels |
| `remove` | Delete record |

### Export

`nifty-positions-export.php` — closed trades CSV  
`NiftyIntradayClosedTradeStats` — win rate, avg R, best/worst

---

## Planned v2 architecture

### PostgreSQL model (proposed)

```prisma
model NiftyIntradayPosition {
  id            String   @id
  userId        String
  instrument    String   // nifty50, banknifty, ...
  symbol        String
  side          String   // long | short
  status        String   // open | closed
  entryPrice    Float
  entryTime     DateTime
  sessionDate   DateTime @db.Date
  quantity      Float?
  stopLoss      Float?
  target1       Float?
  target2       Float?
  target3       Float?
  notes         String?
  source        String?
  highestSinceEntry Float?
  trailedStop   Float?
  closedAt      DateTime?
  closedPrice   Float?
  closedReason  String?
}
```

### Planned API routes

| Method | Path |
|--------|------|
| `GET` | `/api/v1/intraday/positions?status=open&live=1` |
| `POST` | `/api/v1/intraday/positions` |
| `POST` | `/api/v1/intraday/positions/:id/close` |
| `GET` | `/api/v1/intraday/nifty/lite` | PWA payload |
| `GET` | `/api/v1/intraday/nifty/state?positions=0` | Fast analysis-only |

### Planned package layout

```
packages/intraday/src/position-tracker.ts   port NiftyIntradayPositionTracker
packages/intraday/src/position-store.ts     CRUD helpers
apps/api/src/services/intraday-positions.ts
apps/web/src/pages/NiftyPositionsPage.tsx
apps/web/src/pages/IntradayAppPage.tsx      mobile layout (optional)
```

### UI routes (proposed)

| Route | Purpose |
|-------|---------|
| `/intraday/positions` | Ledger + journal (PHP `nifty-positions.php`) |
| `/intraday` | Radar (exists — add log-trade buttons) |
| `/intraday/app` | Mobile PWA shell |

---

## Speed optimization plan

### Phase NP-A — Schema + CRUD (2 days)

| # | Task |
|---|------|
| NP-A1 | Prisma model + migration |
| NP-A2 | `migrate:php` import `nifty_intraday_positions.json` |
| NP-A3 | CRUD API (create, close, list) |
| NP-A4 | Basic `/intraday/positions` table UI |

### Phase NP-B — Live eval (2–3 days)

| # | Task | Target |
|---|------|--------|
| NP-B1 | Port `NiftyIntradayPositionTracker` | Action labels match PHP |
| NP-B2 | `liveQuoteForSymbol` in data-adapters | Intraday mark price |
| NP-B3 | Parallel refresh ≤10 positions | p95 < **2s** |
| NP-B4 | `GET /intraday/nifty/state?positions=0` | Analysis p95 < **200ms** |

### Phase NP-C — Radar + App integration (2–3 days)

| # | Task |
|---|------|
| NP-C1 | Log trade from `/intraday` playbook (POST positions) |
| NP-C2 | Positions block on IntradayPage (60s poll) |
| NP-C3 | `lite` API for mobile |
| NP-C4 | Closed journal stats + CSV export |

### Acceptance criteria

- [ ] PHP JSON migrates without data loss
- [ ] Live action labels match PHP on same fixture
- [ ] Log from 15m playbook pre-fills stop/T1/T2/T3
- [ ] State API with `positions=0` does not load position tracker
- [ ] 60s position poll independent of full analysis refresh

---

## Migration plan

### Today

```bash
# Swing positions only — NOT nifty intraday
pnpm migrate:php -- --user admin@example.com
```

### When NP-A ships

```bash
pnpm migrate:php -- --user admin@example.com \
  --nifty-positions ../stock-verifier/data/nifty_intraday_positions.json
```

Manual workaround: keep using PHP `nifty-positions.php` against JSON file until import exists.

---

## Parity matrix

| Feature | PHP | v2 planned |
|---------|-----|------------|
| JSON / DB storage | ✓ | NP-A |
| Multi-instrument | ✓ | NP-A + instrument resolver |
| Live T1/T2/T3 tracking | ✓ | NP-B |
| Session time exit | ✓ | NP-B |
| Radar log trade | ✓ | NP-C |
| Intraday App | ✓ | NP-C / I-D |
| Closed journal + CSV | ✓ | NP-C |
| 60s positions poll | ✓ | NP-B |
| `positions=0` fast state | ✓ | NP-B (with INTRADAY I-A) |

---

## File reference

### PHP (stock-verifier)

```
nifty-positions.php
nifty-positions-api.php
nifty-positions-export.php
nifty-15m-api.php                    add_position, close_position
intraday-app.php
data/nifty_intraday_positions.json
includes/NiftyIntradayPositionStore.php
includes/NiftyIntradayPositionTracker.php
includes/NiftyIntradayPositionSource.php
includes/NiftyIntradayClosedTradeStats.php
includes/IntradayInstrument.php
```

### Script Screener (v2) — related only

```
packages/intraday/                   analysis engine (no positions yet)
apps/web/src/pages/IntradayPage.tsx
docs/INTRADAY.md
docs/SWING-POSITIONS.md              different ledger
```

---

## Related docs

- [Morning Routine](MORNING-ROUTINE.md) — intraday positions panel (MR-C; blocked until this feature ships)
- [Nifty Intraday 5m/15m](INTRADAY.md) — radar analysis engine
- [Swing Positions](SWING-POSITIONS.md) — multi-day equity ledger
- [Swing Auto](SWING-AUTO.md) — separate swing universe
- [PHP Migration](MIGRATION.md) — will extend for nifty positions
- [API Reference](API.md) — future intraday position routes
