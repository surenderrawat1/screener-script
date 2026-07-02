# Script Screener

Modern rewrite of the PHP **[stock-verifier](../stock-verifier/)** toolkit — **Node.js**, **React**, **Redis**, and **PostgreSQL**.

Screen Indian equities with CFA valuation, swing technical analysis (GC9/E1–E11), and Nifty intraday signals.

> Educational research tool only — not SEBI-registered investment advice.

---

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm db:push && pnpm db:seed
pnpm sync:indices          # import Nifty CSVs from PHP data folder
pnpm dev                   # API :3100 + Web :5173
pnpm dev:worker            # background jobs + auto-radar (separate terminal)
```

Open http://localhost:5173 — login: `admin@example.com` / `admin123`

**Full setup guide:** [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)

---

## Documentation

| Guide | Description |
|-------|-------------|
| [**Documentation index**](docs/README.md) | Start here — map of all docs |
| [Getting Started](docs/GETTING-STARTED.md) | Install, env vars, first run |
| [Architecture](docs/ARCHITECTURE.md) | System design and data flows |
| [API Reference](docs/API.md) | All REST endpoints |
| [Web UI](docs/WEB-UI.md) | Pages and navigation |
| [Swing Auto Radar](docs/SWING-AUTO.md) | Auto-radar architecture, PHP parity, speed plan |
| [Swing Positions](docs/SWING-POSITIONS.md) | Position ledger, exit rules, P&L plan |
| [CFA Screener](docs/SCREENER.md) | Fundamental screener, presets, jobs |
| [Nifty Intraday](docs/INTRADAY.md) | 5m/15m direction, presets, intraday app |
| [Nifty Positions](docs/NIFTY-POSITIONS.md) | Same-day intraday ledger (planned) |
| [CFA Verify](docs/CFA-VERIFY.md) | One-click memo, 8-phase engine plan |
| [Full Verify](docs/FULL-VERIFY.md) | 8-phase allocation gate, thesis (planned) |
| [Morning Routine](docs/MORNING-ROUTINE.md) | Pre-market cockpit (planned) |
| [Trading Presets](docs/TRADING-PRESETS.md) | Swing / ETF / intraday profiles (planned) |
| [Trading Strategies](docs/TRADING-STRATEGIES.md) | 21 curated swing / screener / hybrid strategies (planned) |
| [Stock Details](docs/STOCK-DETAILS.md) | Single-symbol research hub (planned) |
| [Database](docs/DATABASE.md) | PostgreSQL schema |
| [Data Rules](docs/DATA-RULES.md) | DB vs cache policy, 6 AM sync, config files |
| [Redis & Cache](docs/REDIS-CACHE.md) | Key namespaces and TTLs |
| [Packages](docs/PACKAGES.md) | Monorepo structure |
| [Operations](docs/OPERATIONS.md) | Docker, worker, troubleshooting |
| [PHP Migration](docs/MIGRATION.md) | Import data from old app |
| [Development Milestones](docs/MILESTONES.md) | Goals, deliverables, acceptance criteria (M1–M13) |
| [Roadmap](docs/ROADMAP.md) | Completed phases 1–8, planned 9+ |

---

## Stack

| Layer | Tech |
|-------|------|
| API | Fastify + JWT |
| Web | React + Vite |
| Worker | BullMQ |
| Database | PostgreSQL + Prisma |
| Cache | Redis (DB 1, `sv:*` keys) |
| Data | Yahoo Finance, Screener.in, NSE index CSVs |

---

## Monorepo

```
apps/api          Fastify REST + WebSocket
apps/web          React SPA
apps/worker       BullMQ + auto-scan scheduler
packages/core     CFA valuation engine
packages/swing    Swing TA rules (E1–E11, X1–X9, GC9)
packages/intraday Nifty intraday analysis
packages/data-adapters  Yahoo, Screener.in, index sync
packages/db       Prisma + PostgreSQL
packages/cache    Redis client
packages/jobs     BullMQ queues
packages/shared   Types, schemas, constants
```

---

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | API + Web (watch mode) |
| `pnpm dev:worker` | Background worker |
| `pnpm build` | Production build |
| `pnpm test` | Run all tests (66) |
| `pnpm sync:indices` | Import Nifty index CSVs |
| `pnpm migrate:php -- --user admin@example.com` | Import PHP JSON data |

---

## Infrastructure

| Service | Container (Docker) | Local dev |
|---------|-------------------|-----------|
| PostgreSQL | `shared_postgres` | `localhost:5432` |
| Redis | `shared_redis` | `localhost:6379/1` |

```bash
docker compose up --build   # sv_api + sv_worker + sv_web
```

---

## Status

Phases **1–8 complete** (milestones M1–M8) — auth, screener, verify, swing scanner, auto-radar, intraday, index sync, live regime, durable snapshots.

See [Development Milestones](docs/MILESTONES.md) for deliverables and acceptance criteria · [Roadmap](docs/ROADMAP.md) for planned work (M9+).
