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
  "max_scan": 50,
  "background": false
}
```

- Scans symbols from the universe (see [Redis & Cache](REDIS-CACHE.md#universe-resolution))
- Large scans (≥ 400 symbols, or ≥ 80 with TA filters) auto-queue to BullMQ when `background` is omitted
- Returns `{ jobId, status, ... }` for background jobs or inline `{ rows, ... }` for sync

### `GET /api/v1/screener/jobs/:id`

Permission: `view_app`

Returns job row from PostgreSQL plus live progress from Redis.

### `GET /api/v1/presets`

No auth. Lists available screener preset keys.

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

Permission: `run_screener`

```json
{ "symbol": "TCS", "refresh": false }
```

Single-symbol entry evaluation.

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

---

## Swing auto-radar

### `GET /api/v1/swing/auto/state`

Permission: `view_app`

Full auto-radar state: scan hits by tier, live open positions, market regime. Uses durable snapshot (Redis → PostgreSQL fallback).

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

### `GET /api/v1/intraday/nifty/state`

Permission: `view_app`

Query: `?refresh=0&interval=15m`

Returns Nifty direction, MTF confluence, trade plan, signal quality. Use `interval=5m` for 5-minute bars.

---

## Admin

All admin routes require permission `manage_cache` (admin role only by default).

### `GET /api/v1/admin/cache/stats`

Redis memory and key count summary.

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

---

## WebSocket

### `GET /ws/jobs/:id`

Streams job progress events from Redis pub/sub channel `job:{id}`.

Connect after creating a background screener or swing scan job. Events include `phase`, `processed`, `total`, `passed`.

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
