# API Reference

Base URL (local): `http://localhost:3100`

All `/api/v1/*` routes except `/api/v1/auth/login` and `/api/v1/presets` require a valid JWT:

```
Authorization: Bearer <accessToken>
```

Access tokens expire in **15 minutes**. Obtain one via `POST /api/v1/auth/login`.

Optional break-glass admin access: set `SV_ADMIN_KEY` in `.env` and send header `x-admin-key: <value>` — grants full admin role.

---

## Health

### `GET /health`

Liveness probe. No auth.

```json
{ "status": "ok", "version": "0.1.0", "timestamp": "..." }
```

### `GET /health/ready`

Readiness probe. Requires `x-admin-key` when `SV_ADMIN_KEY` is set.

```json
{
  "status": "ready",
  "checks": {
    "postgres": { "ok": true, "host": "localhost" },
    "redis": { "ok": true, "host": "localhost" },
    "worker": { "ok": true, "detail": "heartbeat seen" }
  }
}
```

Returns **503** when Postgres or Redis is down. Worker failure is informational (degraded scans).

---

## Authentication

### `POST /api/v1/auth/login`

```json
{ "email": "admin@example.com", "password": "admin123" }
```

Response:

```json
{
  "accessToken": "eyJ...",
  "user": { "id": "...", "email": "...", "role": "admin" }
}
```

### `GET /api/v1/auth/me`

Returns current JWT payload.

---

## Universes

### `GET /api/v1/universes`

Permission: `view_app`

Lists builtin and custom universes with symbol counts.

### `POST /api/v1/universes`

Permission: `manage_universes`

```json
{ "name": "My Watch Universe", "symbols": ["TCS", "INFY"] }
```

---

## Screener

### `POST /api/v1/screener/run`

Permission: `run_screener`

```json
{
  "universe": "nifty50",
  "preset": "quality",
  "filters": { "min_mos": 20 },
  "maxScan": 200,
  "background": false,
  "refresh": false,
  "exclude_restricted": true
}
```

- Always returns `{ jobId, background: true, status: "pending" }` — poll `GET /api/v1/screener/jobs/:id` or WebSocket `/ws/jobs/:id`
- Large scans (≥ 400 symbols, or ≥ 80 when `filters.show_ta` is set) enqueue to BullMQ worker; smaller scans run inline in the API process
- TA presets (`ta_pullback`, `ta_momentum`, `cfa_best_opportunity`, etc.) fetch Yahoo daily bars and apply RSI / 52w / MACD gates after fundamental filters
- `exclude_restricted: true` (default) skips ASM/GSM/T2T symbols from `config/data/exchange/asm_gsm_manual.json`
- Per-row analyze cache: `sv:screener:row:{preset}:{symbol}` (1 h TTL)

### `GET /api/v1/screener/jobs/:id`

Permission: `view_app`

Returns job row from PostgreSQL plus live progress from Redis (`phase`, `processed`, `total`, `passed`). When `status` is `done`, `result` includes `rows`, `scanned`, `passed`, `cache_hits`, `restricted_skipped`, `exchange_list_as_of`.

### `GET /api/v1/screener/presets`

No auth. Returns all 22 preset keys with labels, descriptions, and filter maps.

### `GET /api/v1/screener/exchange-lists`

No auth. ASM/GSM/T2T restricted symbol summary (`as_of`, `total`).

### `POST /api/v1/screener/export`

Permission: `view_app`

```json
{ "rows": [ /* ScreenerRow[] from last run */ ] }
```

Returns pitch CSV (`text/csv`) — same columns as UI export.

### `GET /api/v1/presets`

No auth. Legacy alias — returns screener preset keys only.

---

## Trading strategies

21 curated swing / positional / hybrid strategies. See [Trading Strategies](TRADING-STRATEGIES.md).

### `GET /api/v1/strategies`

Permission: `view_app`

Query: `?style=swing|positional|hybrid|all` (default `all`)

Returns `{ strategies, style_labels, ready_count, total }`.

### `GET /api/v1/strategies/:id`

Permission: `view_app`

Single strategy definition (`engine`, `preset`, `ready`, `blocked_reason`, etc.).

### `POST /api/v1/strategies/run`

Permission: `run_screener`

```json
{
  "strategy": "swing_strict_enter",
  "universe": "nifty250",
  "maxScan": 100,
  "background": false,
  "refresh": false
}
```

- Sync response: full result (`engine: swing|screener|hybrid`, `hits` or `rows`, `scanned`, …)
- Background response: `{ jobId, background: true, status: "pending" }` when scan exceeds thresholds (swing > 25, hybrid > 40, screener > 80) or `background: true`

### `GET /api/v1/strategies/jobs/:id`

Permission: `view_app`

Same shape as screener jobs; `result` holds the strategy run payload.

---

## CFA Verify

### `POST /api/v1/verify/auto`

Permission: `view_app`

```json
{ "symbol": "TCS", "refresh": false }
```

Runs `CfaValuationEngine` with live Yahoo + Screener.in data. Persists result to `verification_runs` and updates watchlist snapshot if symbol is watched.

### `GET /api/v1/verify/history`

Permission: `view_app`

Query: `?limit=20&symbol=TCS`

### `GET /api/v1/verify/history/:id`

Permission: `view_app`

Single verification run by ID.

---

## Full verify (allocation gate)

8-phase analyst checklist. See [Full Verify](FULL-VERIFY.md).

### `GET /api/v1/verify/full/prefill`

Permission: `view_app`

Query: `?symbol=TCS` — loads watchlist thesis + last CFA snapshot if present.

### `POST /api/v1/verify/full/fetch`

Permission: `view_app`

```json
{ "symbol": "TCS", "refresh": false }
```

Auto-fetches ~80 fields for manual attestation phases.

### `POST /api/v1/verify/full/run`

Permission: `view_app`

```json
{ "symbol": "TCS", "input": { /* phase fields */ }, "refresh": false }
```

Runs full 8-phase engine; persists `verification_runs` with `mode: full`.

### `GET /api/v1/verify/full/draft`

Permission: `view_app`

Query: `?symbol=TCS` — in-progress draft from watchlist meta.

### `PUT /api/v1/verify/full/draft`

Permission: `view_app`

Saves draft attestation fields to watchlist meta.

---

## Stock details

Single-symbol research hub. See [Stock Details](STOCK-DETAILS.md).

### `GET /api/v1/stock/:symbol`

Permission: `view_app`

Query: `?refresh=true` — summary: price, CFA zone, moat, key ratios, TA snapshot.

### `GET /api/v1/stock/:symbol/chart`

Permission: `view_app`

2y daily OHLC + SMA overlays for chart widget.

### `GET /api/v1/stock/:symbol/profile`

Permission: `view_app`

Company profile, sector, market cap, 52w range.

### `POST /api/v1/stock/:symbol/refresh`

Permission: `view_app`

Bypasses caches for summary + chart refetch.

---

## Morning routine

Pre-market cockpit. See [Morning Routine](MORNING-ROUTINE.md).

### `GET /api/v1/morning`

Permission: `view_app`

Aggregates regime, ETF panel, watchlist movers, open swing/intraday positions.

### `POST /api/v1/morning/refresh-etf`

Permission: `view_app`

Refreshes ETF universe quotes for morning panel.

---

## Trading presets

Swing / ETF / intraday profile bundles. See [Trading Presets](TRADING-PRESETS.md).

### `GET /api/v1/trading/presets`

Permission: `view_app`

### `GET /api/v1/trading/presets/:id`

Permission: `view_app`

---

## Watchlist

### `GET /api/v1/watchlist`

Permission: `view_app`

Returns user's main watchlist with items and summary.

### `PUT /api/v1/watchlist/items`

Permission: `view_app`

```json
{ "symbol": "TCS", "notes": "Quality compounder", "meta": { "thesis": "..." } }
```

Upserts symbol in main watchlist.

### `DELETE /api/v1/watchlist/items/:symbol`

Permission: `view_app`

---

## Swing scanner

### `POST /api/v1/swing/scan`

Permission: `run_screener`

```json
{
  "universe": "nifty50",
  "min_verdict": "SETUP_PLUS",
  "zone_52w": "any",
  "gc9_only": false,
  "breakout_volume": false,
  "refresh": false,
  "max_scan": 50
}
```

Runs E1–E11 entry rules + GC9/DC9 bias. Background when ≥ 25 symbols.

### `POST /api/v1/swing/evaluate`

Permission: `view_app`

```json
{
  "symbol": "TCS",
  "refresh": false,
  "min_verdict": "SETUP_PLUS",
  "zone_52w": "any",
  "gc9_only": false,
  "breakout_volume": false,
  "min_rules_passed": 6,
  "require_rules": ["E1", "E7"]
}
```

Single-symbol entry evaluation. Response includes:

- `entry` — full E1–E11 result, trade plan (`stop_loss`, `hard_stop`, `profit_target`, `r_multiple`, `deploy_scale`, …)
- `ta` — 2Y daily technical metrics
- `regime` — NIFTYBEES proxy regime
- `as_of_date` — last daily bar date (EOD)
- `engine_meta` — thresholds, score caps, exit rule reference text
- `scan_eligibility` — whether active filters would include symbol in universe scan

### `POST /api/v1/swing/evaluate-exit`

Permission: `view_app`

```json
{
  "symbol": "TCS",
  "entry_price": 3500,
  "entry_date": "2026-07-01",
  "profit_target": 3800,
  "target_pct": 8.5,
  "refresh": false
}
```

Scores exit rules X1–X9 for a hypothetical or open entry against the current chart. Returns `exit.verdict` (`HOLD` | `EXIT`), triggered rule ids, and per-rule status.

---

## Swing positions

### `GET /api/v1/swing/positions`

Permission: `view_app`

Query: `?status=open|closed&live=1`

When `live=1`, refreshes open positions with current price and exit verdict (X1–X9).

### `POST /api/v1/swing/positions`

Permission: `view_app`

Create open position.

### `POST /api/v1/swing/positions/:id/close`

Permission: `view_app`

```json
{ "closed_price": 3500, "closed_reason": "target hit" }
```

### `POST /api/v1/swing/positions/:id/reopen`

Permission: `view_app`

Reopens a recently closed position within **5 minutes** of close. Returns **410** if undo window expired.

---

## Swing auto-radar

### `GET /api/v1/swing/auto/state`

Permission: `view_app`

Full auto-radar state: scan hits by tier, live open positions, market regime. Uses durable snapshot (Redis → PostgreSQL fallback).

### `GET /api/v1/swing/auto/positions`

Permission: `view_app`

Open positions tracked by auto-radar (subset of ledger).

### `GET /api/v1/swing/auto/profile`

Permission: `view_app`

Engine profile and scan input defaults.

### `POST /api/v1/swing/auto/check-add`

Permission: `view_app`

Validates whether a new position can be added given heat gate and regime.

### `POST /api/v1/swing/auto/scan`

Permission: `run_screener`

Triggers manual auto-scan (same pipeline as worker scheduler).

---

## Intraday

### `GET /api/v1/intraday/instruments`

Permission: `view_app`

Returns index and liquid stock tabs for the intraday radar: `indices`, `stocks`, and combined `instruments` with `fno_supported`, `recommended_preset_5m`, and `recommended_preset_15m`.

### `GET /api/v1/intraday/nifty/state`

Permission: `view_app`

Query: `?refresh=0&interval=15m&instrument=nifty50`

Returns direction, MTF confluence, trade plan, live playbook, and F&O plans. `instrument` accepts index ids (`nifty50`, `banknifty`) or liquid stock ids (`tcs`, `reliance`, …). Response includes `fno_supported` and `fno` (futures/options from spot plan).

### `GET /api/v1/intraday/positions`

Permission: `view_app`

Query: `?status=open|closed`

### `POST /api/v1/intraday/positions`

Permission: `view_app`

Create same-day Nifty intraday position.

### `POST /api/v1/intraday/positions/:id/close`

Permission: `view_app`

### `POST /api/v1/intraday/positions/:id/reopen`

Permission: `view_app`

5-minute undo window — same semantics as swing reopen (**410** when expired).

---

## CFA glossary

### `GET /api/v1/cfa/terms`

Permission: `view_app`

Query: `?category=valuation` — active glossary terms for in-app tooltips.

### `GET /api/v1/cfa/terms/:key`

Permission: `view_app`

Single term definition.

---

## Admin

All admin routes require permission `manage_cache` (admin role only by default).

### `GET /api/v1/admin/cache/stats`

Redis memory and key count summary.

### `GET /api/v1/admin/cache/keys`

Query: `?prefix=sv:ta&limit=50` — browse keys under prefix (must start with `sv:`).

### `DELETE /api/v1/admin/cache`

Query: `?prefix=sv:ta` — delete all keys matching prefix. Use to clear TA chart cache without flushing universes.

### `GET /api/v1/admin/settings`

Effective app settings (merged config files + `app_settings` DB overrides).

### `PATCH /api/v1/admin/settings`

```json
{ "screener": { "max_concurrency": 6 } }
```

Persists operator overrides. See [Data Rules](DATA-RULES.md).

### `GET /api/v1/admin/sync/status`

Last daily sync run timestamp and per-step status.

### `POST /api/v1/admin/sync/daily`

```json
{ "force": false }
```

Triggers `pnpm daily:sync` pipeline (indices + OHLC prefetch). Returns **409** if already running.

### `GET /api/v1/admin/uploads/stats`

NSE equity count, promoter holding count, universe symbol counts.

### `POST /api/v1/admin/uploads/nse-equity`

Multipart: `file` = NSE `EQUITY_L.csv`. Replaces `nse_equity_list` and `total_nse` universe.

### `POST /api/v1/admin/uploads/promoter-holding`

Multipart: CSV with columns `symbol`, `promoter_holding_pct`, optional `as_of`.

### `GET /api/v1/admin/indices/status`

Per-index symbol count, last import date, stale flag (> 120 days).

### `POST /api/v1/admin/indices/sync`

```json
{ "keys": ["nifty50", "nifty500"] }
```

Syncs from `INDICES_DIR` (or body omitted = all defined indices).

### `POST /api/v1/admin/indices/upload`

Multipart: index CSV (MW-NIFTY-* or ind_nifty*list.csv). Index detected from filename.

### CFA terms (admin CRUD)

| Method | Path |
|--------|------|
| `GET` | `/api/v1/admin/cfa/terms` |
| `POST` | `/api/v1/admin/cfa/terms` |
| `PUT` | `/api/v1/admin/cfa/terms/:key` |
| `DELETE` | `/api/v1/admin/cfa/terms/:key` |
| `POST` | `/api/v1/admin/cfa/terms/reseed` |

---

## WebSocket

### `GET /ws/jobs/:id`

Streams job progress events from Redis pub/sub channel `job:{id}`.

Connect after creating a background screener, swing scan, or strategy job. Events include `phase`, `processed`, `total`, `passed`.

---

## Roles and permissions

| Role | Permissions |
|------|-------------|
| `admin` | All |
| `analyst` | view, run_screener, run_parity, refresh_data |
| `viewer` | view_app only |

Defined in `packages/shared/src/constants.ts` (`ROLE_PERMISSIONS`).

---

## Error responses

| Status | Meaning |
|--------|---------|
| 400 | Validation error — body includes Zod `flatten()` or `{ error: "..." }` |
| 401 | Missing or invalid JWT |
| 403 | Valid JWT but insufficient permission |
| 404 | Resource not found |
| 503 | `/health/ready` when dependencies down |
