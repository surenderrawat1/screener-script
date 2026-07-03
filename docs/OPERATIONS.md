# Operations

Day-2 running, deployment, data imports, and troubleshooting.

---

## Process model

| Process | Command | Required for |
|---------|---------|--------------|
| API | `pnpm dev` or `sv_api` container | All HTTP features |
| Web | included in `pnpm dev` or `sv_web` | UI |
| Worker | `pnpm dev:worker` or `sv_worker` container | Background scans, auto-radar, BullMQ jobs |

**Recommended local stack:**

```bash
pnpm dev:all    # API + Web + Worker in one terminal
```

**Common mistake:** Running only `pnpm dev` without the worker. Symptoms:

- `/health/ready` → `worker.ok: false`
- Screener/swing jobs stuck in `pending`
- Auto-radar never updates

---

## Health monitoring

```bash
# Liveness — always 200 if API process is up
curl http://localhost:3100/health

# Readiness — 200 only if Postgres + Redis OK
curl http://localhost:3100/health/ready
```

When `SV_ADMIN_KEY` is set, pass `-H "x-admin-key: YOUR_KEY"` to `/health/ready`.

---

## Docker Compose

```bash
# Prerequisites: external network with Postgres + Redis
docker network create shared_network  # if not exists

docker compose up --build
```

| Service | Container | Notes |
|---------|-----------|-------|
| API | sv_api | Runs `db:push` + `db:seed` on every start |
| Worker | sv_worker | Depends on API container start order |
| Web | sv_web | Static Nginx build |

Environment overrides in `docker-compose.yml` point to `shared_postgres` / `shared_redis`.

---

## Data imports

### Index universes (recommended first)

```bash
pnpm sync:indices
# Or sync specific indices:
pnpm sync:indices nifty50 nifty500
# Or from custom folder:
INDICES_DIR=/path/to/csvs pnpm sync:indices
```

Admin UI: **Admin → Sync indices from disk** or upload individual CSV.

**Scheduled:** Daily at **06:00 IST** by default (`config/schedules.yaml`). Manual trigger:

```bash
pnpm daily:sync              # CLI — indices + OHLC prefetch
pnpm morning:prewarm         # ETF + watchlist quote warmup
```

Admin UI: **Admin → Run daily sync** (`POST /api/v1/admin/sync/daily`) or upload individual CSV.

Supported CSV formats:

- Standard NSE: `ind_nifty50list.csv` (SYMBOL column)
- Market Watch: `MW-NIFTY-50-*.csv`, `MW-NIFTY-TOTAL-MKT-*.csv`

### Full NSE equity list

Upload NSE `EQUITY_L.csv` via Admin. Required for `total_nse` universe scans.

### Promoter holdings

Upload CSV: `symbol`, `promoter_holding_pct`, optional `as_of`.

Used as screener overlay filter after upload.

### ASM / GSM / T2T exchange lists

Restricted symbols live in `config/data/exchange/asm_gsm_manual.json`. Screener runs skip these when **Exclude ASM/GSM/T2T** is checked (default). Update the JSON file and redeploy — no upload endpoint.

### PHP JSON migration

```bash
pnpm migrate:php -- --user admin@example.com
```

Imports from `../stock-verifier/data/` by default:

- Watchlist entries
- Swing positions (open + closed)
- Verification history (if present)

See [Migration](MIGRATION.md) for details.

---

## Auto-radar scheduler

Worker runs `tickSwingAutoScan()` every **60 seconds**.

Scan triggers when `shouldStartAutoScan()` returns true (minimum **300 seconds** since last scan).

Scan modes:

| Mode | When | Behavior |
|------|------|----------|
| Full | Every 30 min | Scan entire universe |
| Incremental | Between full scans | Refresh rotating batch of 30 symbols |

Snapshot saved to Redis + archived to PostgreSQL.

Manual trigger: **Auto Radar → Run scan** or `POST /api/v1/swing/auto/scan`.

---

## Background job thresholds

| Feature | Worker queue (BullMQ) | Inline (API process) |
|---------|----------------------|----------------------|
| Screener | ≥ 400 symbols (≥ 80 with `show_ta`) | Smaller universes |
| Swing scan | ≥ 25 symbols | &lt; 25 symbols |
| Strategy run | swing &gt; 25, hybrid &gt; 40, screener &gt; 80 | Below thresholds |

All screener runs return a `jobId` — poll `GET /api/v1/screener/jobs/:id` or WebSocket `/ws/jobs/:id`.

Strategy runs: `GET /api/v1/strategies/jobs/:id` when background.

---

## Cache administration

Admin UI (**Admin → Cache**) or API:

```bash
# List TA chart keys
curl -H "Authorization: Bearer $TOKEN" \
  'http://localhost:3100/api/v1/admin/cache/keys?prefix=sv:ta&limit=20'

# Clear TA cache only (safe — universes stay in Postgres)
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  'http://localhost:3100/api/v1/admin/cache?prefix=sv:ta'
```

| Prefix | Clears |
|--------|--------|
| `sv:ta` | Yahoo OHLC / TA chart cache |
| `sv:screener:row` | Per-preset analyze row cache |
| `sv:verify` | CFA auto-verify cache (7 d TTL) |

See [Redis & Cache](REDIS-CACHE.md) for full namespace map.

---

## Screener & strategies (ops notes)

- **22 presets** including TA gates (`ta_pullback`, `cfa_best_opportunity`, …) — see [Screener](SCREENER.md)
- **21 trading strategies** at `/strategies` — background checkbox forces async
- **Pitch CSV export** — client-side or `POST /api/v1/screener/export`
- **Row actions** — Watchlist + Add swing from screener/strategy results

---

## Position undo window

Closed swing and intraday positions can be reopened within **5 minutes** via UI or:

- `POST /api/v1/swing/positions/:id/reopen`
- `POST /api/v1/intraday/positions/:id/reopen`

Returns **410** after window expires.

---

## Troubleshooting

### `getaddrinfo ENOTFOUND shared_redis`

**Cause:** Redis URL points to Docker hostname while running on host.

**Fix:** Set in `.env`:

```
REDIS_URL=redis://127.0.0.1:6379/1
DATABASE_URL=postgresql://platform:platform@localhost:5432/stock_verifier
```

Ensure `load-env.ts` is the first import in API/worker (already configured).

### Universe scan returns ~10 symbols

**Cause:** No index data in DB/Redis; dev fallback active.

**Fix:** Run `pnpm sync:indices` and confirm Admin shows symbol counts.

### `worker.ok: false`

**Fix:** Start worker: `pnpm dev:worker`

### JWT expired / 401 errors

Access tokens last 15 minutes. Re-login at `/login`.

### Index sync: "No CSV found"

Upload missing index CSV via Admin, or add files to `INDICES_DIR`:

| Index | Expected file pattern |
|-------|----------------------|
| nifty50 | `ind_nifty50list.csv` or `MW-NIFTY-50-*` |
| nifty100 | `ind_nifty100list.csv` or `MW-NIFTY-100-*` |
| nifty250 | `ind_niftylargemidcap250list.csv` |
| nifty500 | `ind_nifty500list.csv` or `MW-NIFTY-TOTAL-MKT-*` |
| smallcap250 | `ind_niftysmallcap250list.csv` |

### Prisma schema out of date

```bash
pnpm db:generate
pnpm db:push
```

### Clear stale Redis cache

```bash
redis-cli -n 1 KEYS 'sv:*' | xargs redis-cli -n 1 DEL
```

Universes reload from PostgreSQL on next request.

---

## Production checklist

- [ ] Change `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`
- [ ] Change `SEED_ADMIN_PASSWORD` before first seed
- [ ] Set `NODE_ENV=production`
- [ ] Run `pnpm sync:indices` after deploy
- [ ] Ensure worker container is running
- [ ] Configure backups for PostgreSQL
- [ ] Set `CORS_ORIGIN` to production web URL
- [ ] Optional: set `SV_ADMIN_KEY` for ops automation

---

## Logs

| Process | Log location |
|---------|--------------|
| `pnpm dev:api` | stdout — Fastify request logs |
| `pnpm dev:worker` | stdout — job start/complete, auto-scan tick |
| Docker | `docker logs sv_api`, `docker logs sv_worker` |

Worker warnings like `[swing-auto] snapshot archive failed` are non-fatal — Redis snapshot still saved.
