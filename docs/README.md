# Script Screener — Documentation

**Script Screener** is the modern rewrite of the PHP [stock-verifier](../stock-verifier/) toolkit. It screens Indian equities using CFA valuation, swing technical analysis, and Nifty intraday signals — backed by PostgreSQL, Redis, and BullMQ workers.

> **Educational research tool only** — not SEBI-registered investment advice.

---

## Documentation map

| Document | What you'll find |
|----------|------------------|
| [Getting Started](GETTING-STARTED.md) | Install, environment, first run, daily commands |
| [Architecture](ARCHITECTURE.md) | System design, data flows, component diagram |
| [API Reference](API.md) | Every REST endpoint, auth, request/response shapes |
| [Web UI](WEB-UI.md) | Pages, navigation, what each screen does |
| [Swing Auto Radar](SWING-AUTO.md) | Auto-radar architecture, PHP parity, speed plan |
| [Swing Positions](SWING-POSITIONS.md) | Position ledger, exit X1–X9, P&L, speed plan |
| [CFA Screener](SCREENER.md) | Fundamental screener, presets, background jobs |
| [CFA Verify](CFA-VERIFY.md) | One-click valuation memo, 8-phase engine (planned) |
| [Full Verify](FULL-VERIFY.md) | 8-phase allocation gate, scorecard, thesis (planned) |
| [Morning Routine](MORNING-ROUTINE.md) | Pre-market cockpit, checklist, alerts (planned) |
| [Trading Presets](TRADING-PRESETS.md) | One-click swing / ETF / intraday profiles (planned) |
| [Trading Strategies](TRADING-STRATEGIES.md) | 21 curated swing / screener / hybrid strategies (planned) |
| [Nifty Intraday (5m/15m)](INTRADAY.md) | Direction, presets, playbook, intraday app |
| [Nifty Positions](NIFTY-POSITIONS.md) | Same-day intraday trade ledger (PHP parity plan) |
| [Stock Details](STOCK-DETAILS.md) | Single-symbol fundamentals, chart, profile (planned) |
| [Database](DATABASE.md) | PostgreSQL schema, tables, relationships |
| [Data Rules](DATA-RULES.md) | What goes in DB vs cache, 6 AM sync, config & settings |
| [Redis & Cache](REDIS-CACHE.md) | Key namespaces, TTLs, universe resolution |
| [Packages](PACKAGES.md) | Monorepo layout, each package's responsibility |
| [Operations](OPERATIONS.md) | Docker, worker, health checks, troubleshooting |
| [PHP Migration](MIGRATION.md) | Moving data from the old PHP app |
| [Development Milestones](MILESTONES.md) | Goals, deliverables, acceptance criteria per phase |
| [Roadmap](ROADMAP.md) | Completed phases (1–8) and planned work (9+) |

---

## Quick reference

### URLs (local dev)

| Service | URL |
|---------|-----|
| Web app | http://localhost:5173 |
| API | http://localhost:3100 |
| Health | http://localhost:3100/health |
| Readiness | http://localhost:3100/health/ready |

### Default login

```
Email:    admin@example.com
Password: admin123
```

Change via `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` before first `pnpm db:seed`.

### Essential commands

```bash
pnpm install              # install dependencies
pnpm db:push && pnpm db:seed   # create schema + admin user
pnpm sync:indices         # import Nifty CSVs from PHP data folder
pnpm dev                  # API (:3100) + Web (:5173)
pnpm dev:worker           # background jobs + auto-scan (separate terminal)
pnpm build                # compile all packages
pnpm test                 # run all package tests
```

### Repository layout (top level)

```
stock-verifier-v2/
├── apps/
│   ├── api/          Fastify REST + WebSocket
│   ├── web/          React SPA
│   └── worker/       BullMQ consumer + auto-scan scheduler
├── packages/
│   ├── core/         CFA valuation engine
│   ├── swing/        Swing TA rules (E1–E11, GC9, exit X1–X9)
│   ├── intraday/     Nifty intraday presets + direction
│   ├── data-adapters Yahoo, Screener.in, index sync
│   ├── db/           Prisma + PostgreSQL
│   ├── cache/        Redis client
│   ├── jobs/         BullMQ queue definitions
│   └── shared/       Types, Zod schemas, constants
├── docs/             This documentation
├── docker/           Dockerfiles
└── docker-compose.yml
```

### Relationship to PHP stock-verifier

| PHP | Script Screener |
|-----|-----------------|
| `stock-verifier/` folder | `stock-verifier-v2/` (repo name unchanged internally) |
| File/JSON stores | PostgreSQL |
| SQLite/file cache | Redis (`sv:*` keys) |
| PHP CLI background jobs | BullMQ workers |
| PHP pages | React SPA + REST API |
| Session cookies | JWT (15 min access token) |

Index CSV files are still read from `../stock-verifier/data/indices/` by default.
