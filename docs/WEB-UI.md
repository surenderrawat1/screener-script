# Web UI

React SPA served at http://localhost:5173 (dev) or port 5173 (Docker Nginx).

Brand name: **Script Screener** (`apps/web/src/brand.ts`)

All routes except `/login` require authentication.

---

## Navigation

| Route | Page | Purpose |
|-------|------|---------|
| `/login` | LoginPage | Email/password login |
| `/` | DashboardPage | Health status, quick links |
| `/morning` | MorningPage | **Planned** — [MORNING-ROUTINE.md](MORNING-ROUTINE.md) |
| `/presets` | PresetsPage | **Planned** — [TRADING-PRESETS.md](TRADING-PRESETS.md) |
| `/strategies` | StrategiesPage | **Planned** — [TRADING-STRATEGIES.md](TRADING-STRATEGIES.md) |
| `/screener` | ScreenerPage | Run CFA screener on a universe |
| `/verify` | VerifyPage | One-click CFA verify + history |
| `/verify/full` | VerifyFullPage | **Planned** — [FULL-VERIFY.md](FULL-VERIFY.md) |
| `/watchlist` | WatchlistPage | Manage watched symbols |
| `/positions` | PositionsPage | Swing positions (open/closed, live refresh) |
| `/swing` | SwingScanPage | Manual swing TA scan |
| `/swing/auto` | SwingAutoPage | Auto-radar tiers + manual scan trigger |
| `/intraday` | IntradayPage | Nifty intraday direction (5m/15m) |
| `/stock/:symbol` | StockDetailsPage | **Planned** — see [STOCK-DETAILS.md](STOCK-DETAILS.md) |
| `/admin` | AdminPage | Data uploads, index sync |
| `/admin/settings` | SettingsPage | **Planned** — [DATA-RULES.md](DATA-RULES.md) |

---

## Page details

### Dashboard (`/`)

- Live health from `GET /health/ready`
- Shows Postgres, Redis, worker status
- Quick navigation cards to main features
- **Planned:** link to `/morning` as primary daily entry — see [MORNING-ROUTINE.md](MORNING-ROUTINE.md)

### Morning Routine (`/morning`)

See **[MORNING-ROUTINE.md](MORNING-ROUTINE.md)** for aggregated briefing API, checklist, ETF book, and speed plan (MR-A–MR-F).

- **Not implemented** — PHP equivalent: `morning-dashboard.php`
- Planned: regime hero, 7-step checklist, swing/intraday alerts, Nifty 15m, ETF SETUP+, auto high conviction

### Trading Presets (`/presets`)

See **[TRADING-PRESETS.md](TRADING-PRESETS.md)** for three system profiles, URL encoding, deep links, and speed plan (TP-A–TP-F).

- **Not implemented** — PHP equivalent: `trading-presets.php`
- Planned: conservative swing, ETF rotation, intraday session cards + morning chips

### Trading Strategies (`/strategies`)

See **[TRADING-STRATEGIES.md](TRADING-STRATEGIES.md)** for the 21-strategy catalog, three engines (swing / screener / hybrid), background jobs, and speed plan (TS-A–TS-F).

- **Not implemented** — PHP equivalent: `strategies.php`
- Planned: style tabs, strategy select, universe + max scan, job progress, engine-specific results tables

### Screener (`/screener`)

See **[SCREENER.md](SCREENER.md)** for full architecture, presets, and speed plan.

- Select universe (nifty50, nifty500, etc.)
- Choose preset (7 implemented; PHP has 30+)
- Max scan count
- Sync or background run with WebSocket job progress
- Results table: symbol, price, P/E, ROE, MOS, recommendation
- **Planned:** Details link per row → `/stock/:symbol` ([STOCK-DETAILS.md](STOCK-DETAILS.md)); TA presets, filter form, CSV export, incremental progress bar

### Verify (`/verify`)

See **[CFA-VERIFY.md](CFA-VERIFY.md)** for full architecture, PHP 8-phase parity, memo UI, and speed plan (V-A–V-D).

See also **[STOCK-DETAILS.md](STOCK-DETAILS.md)** — full symbol hub (chart, profile) planned separately.

- Enter symbol → `POST /api/v1/verify/auto`
- Displays DCF, MOS, verdict, key ratios (valuation subset today)
- Recent verification history sidebar
- **Planned:** investment memo hero, verify cache, link to `/stock/:symbol` and `/verify/full`

### Full Verify (`/verify/full`)

See **[FULL-VERIFY.md](FULL-VERIFY.md)** for 8-phase wizard, scorecard, investment-ready gate, and speed plan (FV-A–FV-E).

- **Not implemented** — PHP equivalent: `index.php`
- Planned: tabbed phases 0–8, Fetch & Fill, manual attestation, watchlist thesis save

### Watchlist (`/watchlist`)

- View/add/remove symbols
- Thesis and review metadata
- Linked to verify snapshots
- **Planned:** symbol link → `/stock/:symbol` ([STOCK-DETAILS.md](STOCK-DETAILS.md))

### Positions (`/positions`)

See **[SWING-POSITIONS.md](SWING-POSITIONS.md)** for full architecture, exit rules, and speed plan.

- Open and closed swing trades (PostgreSQL)
- Filter by status; static ledger view
- Live exit evaluation: use `?live=1` API or **Auto Radar** (`/swing/auto`)
- **Planned:** 60s live poll, add/close forms, P&L with charges on this page

### Swing (`/swing`)

- Universe scan with filters:
  - Min verdict: ENTER / SETUP+ / WATCH / ALL
  - 52-week zone filter
  - GC9 only toggle
  - Breakout volume filter
- Ranked hits table

### Auto Radar (`/swing/auto`)

See **[SWING-AUTO.md](SWING-AUTO.md)** for full architecture, tier model, and speed plan.

- Tier view: `high_conviction`, `strict_enter`, `setup_radar`, `breakout_surge`
- Market regime banner + deploy guidance
- Open positions with live exit evaluation
- **Run scan** / **Refresh** buttons
- Worker-driven 5m scans (no browser tab required)

### Intraday (`/intraday`)

See **[INTRADAY.md](INTRADAY.md)** (5m/15m radar) and **[NIFTY-POSITIONS.md](NIFTY-POSITIONS.md)** (intraday ledger — planned).

- Nifty 50 only (PHP supports BankNifty, stocks, etc.)
- 5m / 15m interval toggle
- Direction, MTF confluence, live playbook steps
- 60s auto-poll; manual refresh bypasses chart cache
- **Not on this page:** candlestick chart, preset table, scalp gate, log-trade / positions (PHP `nifty-15m.php`, `intraday-app.php`)

### Admin (`/admin`)

Requires `manage_cache` permission (admin role).

| Section | Action |
|---------|--------|
| Index universes | Status table, sync from disk, upload CSV |
| Current data | NSE count, promoter count, universe sizes |
| NSE equity upload | `EQUITY_L.csv` → total_nse |
| Promoter holding upload | CSV with symbol + holding % |

---

## Shared UI components

`components/PageLayout.tsx`:

| Component | Use |
|-----------|-----|
| `Page` | Consistent page wrapper with `.page` class |
| `PageHeader` | Title + subtitle |
| `PageLoading` | Loading spinner state |
| `EmptyState` | No data placeholder |

Global styles: `src/index.css` — cards, tables, buttons, grid layouts, segmented controls.

---

## API client

`src/api.ts`:

```typescript
api<T>(path, options?)  // JSON fetch with Bearer token
getToken() / setToken() / clearToken()  // localStorage JWT
```

File uploads use raw `fetch` with `FormData` (multipart).

---

## Auth flow

1. Login → store `accessToken` in localStorage
2. `AuthProvider` loads `GET /api/v1/auth/me` on mount
3. Protected routes redirect to `/login` if no user
4. Logout clears token

Token expiry: 15 minutes — user must re-login after idle period.

---

## Vite dev proxy

API requests from the dev server proxy to `http://localhost:3100`. WebSocket connections for job progress use the same host.

---

## Production build

```bash
pnpm --filter @sv/web build
```

Output: `apps/web/dist/` — served by Nginx in `sv_web` Docker container.
