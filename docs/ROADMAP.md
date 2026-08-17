# Roadmap

Development phases for Script Screener. Phases 1–8 are **complete**. Phases 9+ are planned.

---

## Completed phases

### Phase 1 — MVP foundation

- JWT auth + RBAC (admin, analyst, viewer)
- Screener API with sync/background jobs
- CFA verify endpoint
- BullMQ worker + WebSocket job progress
- React dashboard, screener, verify pages
- Docker Compose on `shared_network`
- PostgreSQL schema via Prisma

### Phase 2 — Live data

- `@sv/data-adapters` — Yahoo Finance + Screener.in
- Redis caching (7d stock, 24h screener)
- Live verify and screener (fallback to sample metrics on fetch failure)
- **Doc:** [SCREENER.md](SCREENER.md)

### Phase 3 — CFA engine parity

- Full `CfaValuationEngine` port in `@sv/core`
- Golden parity tests vs PHP `validate-logic.php`
- Admin CSV uploads (NSE equity, promoter holdings)
- Admin web page
- **Docs:** [SCREENER.md](SCREENER.md) (valuation path); [CFA-VERIFY.md](CFA-VERIFY.md) (screening memo); [FULL-VERIFY.md](FULL-VERIFY.md) (allocation gate planned); [STOCK-DETAILS.md](STOCK-DETAILS.md) (symbol hub shipped); one-click memo → [CFA-VERIFY.md](CFA-VERIFY.md)

### Phase 4 — User data & PHP migration

- Watchlists with thesis/review meta
- Verification history persistence
- Swing positions in PostgreSQL
- `pnpm migrate:php` CLI

### Phase 5 — Swing scanner engine

- `@sv/swing` — GC9/DC9, E1–E11, ranker, universe scanner
- Yahoo daily OHLC (2y) with TA cache
- `POST /api/v1/swing/scan`, `/swing/evaluate`
- BullMQ `sv-swing-scan` queue
- Web Swing page

### Phase 6 — Auto-radar, exit rules, intraday

- Exit evaluation X1–X9
- `SwingAutoDecision` + `SwingAutoScreener` tiers
- `@sv/intraday` — 13 presets, Nifty playbook
- Auto Radar and Intraday web pages
- Live position refresh API
- **Architecture & speed plan:** [SWING-AUTO.md](SWING-AUTO.md)
- **Positions ledger & exit rules:** [SWING-POSITIONS.md](SWING-POSITIONS.md)
- **Nifty 5m/15m & intraday app:** [INTRADAY.md](INTRADAY.md)

### Phase 7 — Live Nifty, scheduler, incremental scan

- Yahoo 5m/15m Nifty charts
- Redis swing auto snapshot
- Incremental scan (full every 30m, rotate 30)
- Worker auto-scan tick (60s, 300s interval)
- `POST /api/v1/swing/auto/scan`
- **Docs:** [INTRADAY.md](INTRADAY.md), [NIFTY-POSITIONS.md](NIFTY-POSITIONS.md) (ledger planned)

### Phase 8 — Data foundation

- Index CSV parser + `pnpm sync:indices`
- Universe resolution: Redis → DB → constituents
- Live market regime (`regimeFromBars`, NIFTYBEES proxy)
- Swing snapshot PostgreSQL archive + durable read path
- Admin index sync API/UI
- 66 tests passing

---

## Planned phases

### Phase 9 — Cache admin & job UX

- [x] Admin UI: browse keys by `sv:*` prefix, clear selected prefix
- [x] Chunked job progress (per-symbol status in worker)
- [x] `pnpm dev:all` — API + web + worker in one command
- [x] Verify endpoint uses `sv:verify` cache to avoid duplicate fetches
- [ ] Update [OPERATIONS.md](OPERATIONS.md) and [API.md](API.md) — **done** (Jul 2026)
- **Doc:** [CFA-VERIFY.md](CFA-VERIFY.md) Phase V-A

### Data policy & daily sync (parallel track)

Reference data in PostgreSQL; market cache warmed once at **06:00 IST**. Phases **DR-A** through **DR-D**.

- [x] Config loader (`config/*.yaml`) in `@sv/shared` (DR-A)
- [x] `app_settings` table + `GET/PATCH /api/v1/admin/settings` (DR-B)
- [x] Daily sync worker job + `pnpm daily:sync` CLI (DR-C)
- [x] Settings UI at `/admin` — daily sync cron (DR-D partial)
- **Doc:** [DATA-RULES.md](DATA-RULES.md)

### Full Verify (parallel track)

8-phase allocation wizard — `index.php` parity. Phases **FV-A** through **FV-E**.

- [x] `/verify/full` route + Fetch & Fill API
- [x] `VerificationEngine` + investment-ready badge + scorecard UI
- [x] Phase 6 sector panels, Phase 8 thesis → watchlist
- [x] EPS dual basis + cache_meta D1 gate + Hindi/mobile polish (FV-E)
- **Doc:** [FULL-VERIFY.md](FULL-VERIFY.md)

### CFA Verify memo (parallel track)

Full one-click memo UI + `VerificationEngine` port. Phases **V-B** through **V-D**.

- [x] Investment memo hero, assumptions, annual report scan (V-B)
- [x] Port `VerificationEngine` + `/verify/full` (see Full Verify track)
- [ ] Batch verify BullMQ job polish (V-D)
- **Docs:** [CFA-VERIFY.md](CFA-VERIFY.md) · [FULL-VERIFY.md](FULL-VERIFY.md)

### Stock Details (parallel track)

Single-symbol research hub — fundamentals, valuation, chart, Screener profile, TA grid, chart patterns. **SD-A through SD-C shipped**; SD-D partial (pledge on page, expanded parity).

- [x] `GET /api/v1/stock/:symbol` summary API + `/stock/:symbol` page (SD-A)
- [x] Screener profile + lazy chart/profile endpoints (SD-B, SD-C)
- [x] Chart phases, TA grid, pattern overlays, IV drift banner
- [x] Admin per-symbol cache refresh + cross-page Details links
- [x] Promoter pledge on Details page (Screener.in + warehouse upload)
- [x] RELIANCE/HDFCBANK cross-page governance fixtures (pledge honesty, Screener flags, shareholding → Full Verify)
- **Doc:** [STOCK-DETAILS.md](STOCK-DETAILS.md)

### Phase 10 — Morning dashboard & LTG auto

- [x] Morning briefing dashboard (regime, top hits, position alerts)
- [x] LTG (long-term growth) auto-screener pipeline (`/ltg/auto`, scheduler, Morning panel)
- [x] Email/webhook notifications for tier changes (optional)
- **Doc:** [MORNING-ROUTINE.md](MORNING-ROUTINE.md) (morning cockpit); LTG auto via [API.md](API.md#ltg-auto-fundamental--technical-gate)

### Morning Routine (parallel track)

Pre-market one-screen cockpit — `morning-dashboard.php` parity. Phases **MR-A** through **MR-F** shipped.

- [x] `GET /api/v1/morning` + `/morning` page
- [x] NSE session, checklist, regime hero, alert banner
- [x] Swing + nifty + intraday + auto panels; ETF SETUP+ scan (MR-D)
- [x] Trading preset chips (MR-E) — see [TRADING-PRESETS.md](TRADING-PRESETS.md) TP-E
- **Doc:** [MORNING-ROUTINE.md](MORNING-ROUTINE.md)

### Trading Strategies (parallel track)

Curated 21-strategy runner — `strategies.php` parity. Phases **TS-A** through **TS-F**.

- [x] `GET /api/v1/strategies` + `/strategies` page (TS-A)
- [x] Swing + screener engines; hybrid screener→swing pipeline (TS-B–TS-C)
- [x] Expand screener presets for positional strategies (TS-D) — see [SCREENER.md](SCREENER.md)
- [x] Background strategy jobs + progress UI (TS-E)
- [x] Deep link autorun on `/strategies` (TS-F3)
- **Doc:** [TRADING-STRATEGIES.md](TRADING-STRATEGIES.md)

### Phase 11 — Strategy builder

- [x] User-defined screener filter presets (persist to `screener_presets`)
- [ ] Custom swing rule profiles
- [ ] Strategy backtest runner (historical bars)
- **System presets (read-only):** [TRADING-PRESETS.md](TRADING-PRESETS.md) — conservative / ETF / intraday hub
- **System strategies (read-only):** [TRADING-STRATEGIES.md](TRADING-STRATEGIES.md) — 21 curated strategies (TS-A–TS-F; overlaps M11 CRUD)

### Phase 12 — Backtesting & parity expansion

- [ ] Swing backtest engine vs PHP historical runs
- [ ] Screener backtest with point-in-time fundamentals
- [ ] Expanded parity suite for edge cases

### Phase 13 — Full verify & production hardening

- [ ] Batch verify API (`verify_batch` job type)
- [ ] Refresh token rotation
- [ ] Rate limiting per user
- [ ] Prometheus metrics endpoint
- [ ] CI pipeline (build + test on PR)

---

## How to contribute to the next phase

1. Pick an unchecked item from Phase 9+ (see [MILESTONES.md](MILESTONES.md) for deliverables and acceptance criteria)
2. Implement in `packages/*` with tests
3. Wire API + web if user-facing
4. Update relevant doc in `docs/`
5. Mark phase item complete in [MILESTONES.md](MILESTONES.md) and this file

---

## Test coverage summary

| Package | Tests | Focus |
|---------|-------|-------|
| `@sv/core` | 13 | CFA valuation parity |
| `@sv/shared` | 3 | Index CSV parsing |
| `@sv/swing` | 33 | Entry, exit, auto, incremental, regime |
| `@sv/intraday` | 17 | Direction, presets |
| **Total** | **66** | |

Run all: `pnpm test`
