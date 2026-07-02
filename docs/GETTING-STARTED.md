# Getting Started

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | ≥ 20 |
| pnpm | 9.x (see `packageManager` in root `package.json`) |
| PostgreSQL | 14+ (via `shared_postgres` Docker container or local) |
| Redis | 6+ (via `shared_redis` Docker container or local) |

The app expects a database named `stock_verifier` on the shared Postgres instance.

---

## 1. Create the database (once)

If using the shared Docker Postgres:

```bash
docker exec shared_postgres psql -U platform -d market_research \
  -c "CREATE DATABASE stock_verifier;"
```

---

## 2. Configure environment

```bash
cd tools/stock-verifier-v2
cp .env.example .env
```

### Key variables

| Variable | Purpose | Local dev example |
|----------|---------|-------------------|
| `DATABASE_URL` | PostgreSQL connection | `postgresql://platform:platform@localhost:5432/stock_verifier` |
| `REDIS_URL` | Redis connection (DB 1 reserved) | `redis://localhost:6379/1` |
| `JWT_ACCESS_SECRET` | Sign access tokens (min 32 chars) | Change in production |
| `JWT_REFRESH_SECRET` | Sign refresh tokens | Change in production |
| `CORS_ORIGIN` | Allowed web origin | `http://localhost:5173` |
| `API_PORT` | API listen port | `3100` |
| `SEED_ADMIN_EMAIL` | First admin user email | `admin@example.com` |
| `SEED_ADMIN_PASSWORD` | First admin password | `admin123` |
| `INDICES_DIR` | NSE index CSV folder | Defaults to `../stock-verifier/data/indices` |
| `SV_ADMIN_KEY` | Optional break-glass API key | Sends `x-admin-key` header for admin access |

**Docker vs local:** Inside containers use `shared_postgres` / `shared_redis` hostnames. On the host use `localhost` ports.

---

## 3. Install and initialize

```bash
pnpm install
pnpm db:generate    # generate Prisma client
pnpm db:push        # apply schema to PostgreSQL
pnpm db:seed        # create admin user + builtin universes
pnpm sync:indices   # import Nifty 50 + 500 from PHP CSV folder
```

Expected `sync:indices` output:

```
✓ nifty50: 50 symbols
✓ nifty500: 750 symbols
✗ nifty100: No CSV found   (upload CSV via Admin when available)
```

---

## 4. Run locally

**Terminal 1 — API + Web:**

```bash
export DATABASE_URL=postgresql://platform:platform@localhost:5432/stock_verifier
export REDIS_URL=redis://localhost:6379/1
pnpm dev
```

**Terminal 2 — Worker (required for background scans and auto-radar):**

```bash
export DATABASE_URL=postgresql://platform:platform@localhost:5432/stock_verifier
export REDIS_URL=redis://localhost:6379/1
pnpm dev:worker
```

Open http://localhost:5173 and log in with the seed admin credentials.

### Verify everything is healthy

```bash
curl http://localhost:3100/health
curl http://localhost:3100/health/ready
```

`/health/ready` reports:

- `postgres.ok` — database reachable
- `redis.ok` — Redis ping
- `worker.ok` — worker heartbeat seen in Redis (false until `pnpm dev:worker` runs)

---

## 5. Run with Docker

Requires external network `shared_network` with `shared_postgres` and `shared_redis`:

```bash
docker compose up --build
```

| Container | Port | Role |
|-----------|------|------|
| `sv_api` | 3100 | API (runs `db:push` + `db:seed` on start) |
| `sv_worker` | — | BullMQ + auto-scan tick |
| `sv_web` | 5173 | Nginx serving built React app |

---

## Daily development commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | API + Web in watch mode |
| `pnpm dev:api` | API only |
| `pnpm dev:web` | Web only |
| `pnpm dev:worker` | Worker only |
| `pnpm build` | Production build all packages |
| `pnpm typecheck` | TypeScript check all packages |
| `pnpm test` | Run all tests |
| `pnpm sync:indices` | Re-import index CSVs |
| `pnpm migrate:php -- --user admin@example.com` | Import PHP JSON data |

### Run specific test suites

```bash
pnpm --filter @sv/core test
pnpm --filter @sv/shared test
pnpm --filter @sv/swing test
pnpm --filter @sv/intraday test
```

---

## First-time checklist

- [ ] PostgreSQL `stock_verifier` database exists
- [ ] `.env` copied and `DATABASE_URL` / `REDIS_URL` point to localhost
- [ ] `pnpm db:push` succeeded
- [ ] `pnpm db:seed` created admin user
- [ ] `pnpm sync:indices` loaded at least nifty50
- [ ] `pnpm dev` running — web loads at :5173
- [ ] `pnpm dev:worker` running — `/health/ready` shows `worker.ok: true`
- [ ] Logged in and Dashboard shows green health

---

## Next steps

- [Web UI guide](WEB-UI.md) — what each page does
- [Admin uploads](OPERATIONS.md#data-imports) — NSE equity list, promoter holdings, index CSVs
- [PHP migration](MIGRATION.md) — watchlists and swing positions from old app
