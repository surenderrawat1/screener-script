# Database

PostgreSQL database: **`stock_verifier`**

ORM: **Prisma** (`packages/db/prisma/schema.prisma`)

**Policy:** Slow-changing reference data belongs here, not Redis. See [Data Rules](DATA-RULES.md).

Apply schema: `pnpm db:push`  
Generate client: `pnpm db:generate`

---

## Entity relationship overview

```
User ──┬── Session
       ├── Universe (custom)
       ├── Job
       ├── Watchlist ── WatchlistItem
       ├── VerificationRun
       ├── SwingPosition
       └── AuditLog

Universe ── UniverseSymbol

IndexConstituent (standalone, keyed by indexKey + symbol)

NseEquity, PromoterHolding (admin uploads)

SwingAutoSnapshotArchive (auto-radar history)
```

---

## Tables

### `users`

| Column | Type | Notes |
|--------|------|-------|
| id | cuid | Primary key |
| email | string | Unique |
| password_hash | string | bcrypt |
| role | enum | `admin`, `analyst`, `viewer` |
| created_at | timestamp | |
| last_login_at | timestamp? | Updated on login |

### `sessions`

Refresh token storage (future use). Linked to `users`.

### `universes` / `universe_symbols`

Builtin universes seeded on `db:seed`:

| key | name |
|-----|------|
| nifty50 | Nifty 50 |
| nifty100 | Nifty 100 |
| nifty200 | Nifty 200 |
| nifty500 | Nifty 500 |
| nifty250 | Nifty Midcap 250 |
| smallcap250 | Nifty Smallcap 250 |
| total_nse | All NSE (uploaded CSV) |

`universe_symbols` holds the current symbol list per universe. Populated by index sync or NSE CSV upload.

### `index_constituents`

Historical index membership with effective dating:

| Column | Purpose |
|--------|---------|
| index_key | e.g. `nifty50` |
| symbol | NSE ticker |
| effective_from | When symbol was added |
| effective_to | NULL = current member; set when removed |

### `nse_equity_list`

Full NSE equity symbols from `EQUITY_L.csv` upload. Powers `total_nse` universe.

### `promoter_holdings`

Promoter holding % per symbol for screener overlay filters.

### `jobs`

Background job tracking for screener and swing scans.

| Column | Purpose |
|--------|---------|
| type | `screener`, `verify_batch`, `swing_scan`, `index_sync`, `daily_close` |
| status | `pending`, `running`, `done`, `failed` |
| input | JSON request payload |
| result | JSON output |
| progress | JSON progress snapshot |
| created_by | User FK |

### `watchlists` / `watchlist_items`

Per-user watchlists. Default name: **Main**. Items store `symbol`, `notes`, `meta` JSON (thesis, review dates, verify snapshot).

### `swing_positions`

Open and closed swing trades.

| Column | Notes |
|--------|-------|
| id | String ID (preserved from PHP migration) |
| status | `open` or `closed` |
| entry_price, entry_date | Entry details |
| stop_loss, profit_target | Risk parameters |
| highest_since_entry, trailed_stop_loss | Trail tracking |
| closed_at, closed_price, closed_reason | Exit details |

### `verification_runs`

CFA verify history per symbol.

| Column | Purpose |
|--------|---------|
| symbol | NSE ticker |
| mode | Usually `auto` |
| input | Request options |
| result | Full engine output JSON |

### `swing_auto_snapshots`

Durable archive of auto-radar scan snapshots (Redis is primary; this is fallback).

| Column | Purpose |
|--------|---------|
| saved_at | Snapshot timestamp |
| last_full_scan_at | Last full universe scan |
| scan_mode | `full` or `incremental` |
| rotate_offset | Batch rotation index |
| regime_key | Market regime at scan time |
| scan, tiers, summary | JSON payloads |

### `audit_log`

User action audit trail (action, resource, meta JSON).

### `screener_presets`

Saved filter presets (system and user-defined). System presets are seeded from `config/presets/screener.yaml` (planned). See [Data Rules](DATA-RULES.md).

---

## Planned: `app_settings`

Runtime overrides for sync schedule, TTLs, and feature flags — set via Admin Settings UI. Overrides win over `config/*.yaml`. See [Data Rules](DATA-RULES.md).

---

## Enums

```prisma
UserRole:     admin | analyst | viewer
JobStatus:    pending | running | done | failed
JobType:      screener | verify_batch | swing_scan | index_sync | daily_close
UniverseType: builtin | custom | uploaded
SwingPositionStatus: open | closed
```

---

## CLI tools (`@sv/db`)

| Command | Script | Purpose |
|---------|--------|---------|
| `pnpm db:seed` | `seed.ts` | Admin user + builtin universes |
| `pnpm db:push` | Prisma | Apply schema without migration files |
| `pnpm db:migrate` | Prisma | Create migration (production) |
| `pnpm migrate:php` | `migrate-php-data.ts` | Import PHP JSON stores |

Index sync CLI lives in `@sv/data-adapters`: `pnpm sync:indices`.

---

## Query patterns

**Universe symbols** — resolved in this order (see [Redis & Cache](REDIS-CACHE.md)):

1. Redis `sv:universe:{key}`
2. `universe_symbols` join
3. `index_constituents` where `effective_to IS NULL`
4. `nse_equity_list` (for `total_nse` only)
5. Dev fallback (non-production only)

**Swing auto state** — `getSwingAutoSnapshotDurable()`:

1. Redis `sv:swing:auto`
2. Latest `swing_auto_snapshots` row by `saved_at`

---

## Backup recommendations

| Data | Priority | Method |
|------|----------|--------|
| `users`, `swing_positions`, `watchlist_items` | High | `pg_dump stock_verifier` |
| `verification_runs` | Medium | Same dump |
| `jobs` | Low | Ephemeral; optional |
| Redis | Medium | Regenerates from fetches; universe/index worth backing up |
| Index CSVs | High | Keep source files in `stock-verifier/data/indices/` |
