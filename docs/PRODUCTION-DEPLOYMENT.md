# Production Deployment Guide (M13+)

## Goal
Deploy `stock-verifier-v2` in a secure, observable, batch-capable mode:
- Web UI (`@sv/web`)
- API (`@sv/api`)
- Worker (`@sv/worker`): BullMQ job execution + scheduled ticks

## Prerequisites
1. PostgreSQL (for Prisma)
2. Redis (for BullMQ queues + operational cache)
3. A process supervisor (systemd, PM2, Docker Compose, Kubernetes, etc.)
4. Shared Docker network `shared_network` when using the bundled compose file (create with `docker network create shared_network`)

## Preflight (dry-run)
From the repo root (loads `.env` if present):

```bash
pnpm deploy:check
pnpm deploy:check -- --build   # also runs full workspace build
```

Fails on missing `DATABASE_URL` / `REDIS_URL`. Weak/placeholder `JWT_*_SECRET` values fail only when `NODE_ENV=production` (local dry-runs warn instead).

## Required Environment Variables
At minimum, set the following (see also `.env.example`):
- `NODE_ENV=production`
- `DATABASE_URL=postgresql://<user>:<pass>@<host>:5432/<db>`
- `REDIS_URL=redis://<host>:6379/1`
- `JWT_ACCESS_SECRET=<strong-secret>` (≥24 chars; used to sign access JWTs)
- `CORS_ORIGIN=<your-web-url>` (e.g. `https://screener.example.com`)

### Strongly recommended
- `JWT_REFRESH_SECRET=<strong-secret>` (keep distinct from access secret)
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (first boot only)

### M13 additions
- `SV_RATE_LIMIT_WINDOW_SECONDS` (default: `60`)
- `SV_RATE_LIMIT_MAX_PER_WINDOW` (default: `30`)
- `SV_REFRESH_TOKEN_TTL_DAYS` (default: `30`)

### Optional alerts
- `SV_ADMIN_KEY=<break-glass api key>` enables `x-admin-key` access to `/health/ready`.
- `MORNING_ALERT_WEBHOOK_URL` — Slack/Discord webhook for morning exit alerts
- `SWING_RADAR_WEBHOOK_URL` — webhook for High Conviction (HOT) tier additions (falls back to `MORNING_ALERT_WEBHOOK_URL`)
- `SWING_RADAR_EMAIL` / `SWING_RADAR_WEBHOOK` — set `0` to disable radar email/webhook
- WhatsApp HOT alerts: see [WHATSAPP-ALERTS.md](WHATSAPP-ALERTS.md) — Twilio sandbox recommended; or CallMeBot / Meta Cloud API
- SMTP + `SIGNAL_ALERT_EMAIL_TO` — trade signal and radar emails

## Build / Migrate
1. Install deps:
   - `pnpm install --frozen-lockfile`
2. Generate Prisma client and apply schema:
   - `pnpm db:generate`
   - `pnpm db:push` (or `pnpm db:migrate` when migrations are used)
   - `pnpm db:seed` (first boot — creates admin from `SEED_ADMIN_*`)
3. Warm indices (recommended after deploy):
   - `pnpm sync:indices`

## Build Artifacts
```bash
pnpm build
```

## Option A — Docker Compose
Requires external network + Postgres/Redis already on `shared_network` (or edit compose to add them).

```bash
docker network create shared_network   # once
docker compose up -d --build
```

Do **not** run host `pnpm --filter @sv/worker run dev` (or the parallel API/web/worker `pnpm` stack) at the same time — Redis schedule leadership is single-holder, so a host worker will steal evening GTT / daily proof / auto-scan ticks from `sv_worker`.

Services:
| Container | Role | Port |
|-----------|------|------|
| `sv_api` | Fastify API | host `3100` |
| `sv_worker` | BullMQ worker | — |
| `sv_web` | Nginx + SPA | host `5173` → container `80` |

API command in compose runs `pnpm db:push && pnpm db:seed` then starts the server.

Set `CORS_ORIGIN` to the public web origin (not only localhost) when exposing beyond the host.

## Option B — Process supervisor (bare metal / VM)
Start **three** services after `pnpm build`:
1. **Worker** — `pnpm --filter @sv/worker run start`
2. **API** — `pnpm --filter @sv/api run start`
3. **Web** — serve `apps/web/dist` via nginx (see `docker/nginx.conf`) or `pnpm --filter @sv/web run preview`

Put API + web behind a reverse proxy (nginx/traefik). Proxy `/api`, `/health`, `/metrics`, and `/ws` to the API.

## Observability
- Health: `GET /health` (liveness), `GET /health/ready` (Postgres + Redis + worker heartbeat)
- Metrics: `GET /metrics` (Prometheus text)
  - BullMQ waiting depth: `sv-screener`, `sv-swing-scan`, `sv-verify-batch`
  - Worker heartbeat age (seconds)

## Smoke checklist
```bash
curl -sS http://localhost:3100/health
curl -sS http://localhost:3100/health/ready   # postgres + redis + worker heartbeat
curl -sS http://localhost:3100/metrics | head
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:5173/
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:5173/health
docker compose ps
docker logs sv_worker --tail 20   # expect schedule leader=true
```
Then in the UI: login → Morning → Strategies → Full Verify Fetch & Fill.

## Operational Notes
- If Redis is down, scan jobs may degrade (worker health is informational in `/health/ready`).
- Refresh tokens are stored/rotated in the Prisma `sessions` table.
- Rate limiting returns `429` and sets `Retry-After`.
- Keep API, worker, and web on the same release; rebuild packages before restarting (`pnpm build`).
