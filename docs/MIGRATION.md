# PHP Migration Guide

Migrate user data from the legacy PHP **stock-verifier** app into Script Screener's PostgreSQL database.

---

## Prerequisites

1. Script Screener installed and schema applied (`pnpm db:push`)
2. Admin user exists (`pnpm db:seed`)
3. PHP data folder available at `../stock-verifier/data/`

---

## Quick migration

```bash
cd tools/stock-verifier-v2

# Ensure target user exists
pnpm db:seed

# Import all default PHP JSON files
pnpm migrate:php -- --user admin@example.com
```

---

## What gets imported

| PHP source | PostgreSQL destination | Default path |
|------------|------------------------|--------------|
| Watchlist JSON | `watchlists` + `watchlist_items` | `data/watchlist.json` |
| Swing positions | `swing_positions` | `data/swing_positions.json` |
| Nifty intraday positions | **Not imported** (planned) | `data/nifty_intraday_positions.json` |
| Verify history | `verification_runs` | `data/verify_history.json` (if exists) |

> Nifty intraday positions are **not** swing positions. See [NIFTY-POSITIONS.md](NIFTY-POSITIONS.md) vs [SWING-POSITIONS.md](SWING-POSITIONS.md).

Custom paths via CLI flags (see below).

---

## CLI options

```bash
pnpm migrate:php -- \
  --user admin@example.com \
  --watchlist ../stock-verifier/data/watchlist.json \
  --positions ../stock-verifier/data/swing_positions.json \
  --verify ../stock-verifier/data/verify_history.json
```

| Flag | Purpose |
|------|---------|
| `--user` | Email of existing Script Screener user (required) |
| `--watchlist` | Path to PHP watchlist JSON |
| `--positions` | Path to PHP swing_positions.json |
| `--verify` | Path to verify history JSON |

Default data root: `tools/stock-verifier/data/`

---

## Symbol resolution

PHP watchlist keys may be company names or mixed formats. The migrator:

1. Tries `symbol`, `stock_name`, and JSON key as NSE tickers
2. Strips `.NS` / `.BO` suffixes
3. Falls back to fuzzy name match against uploaded `nse_equity_list`
4. Preserves original PHP key in `meta.php_key`

**Tip:** Upload NSE `EQUITY_L.csv` via Admin before migrating watchlists for better name resolution.

---

## Swing positions

PHP position IDs are preserved as PostgreSQL primary keys.

Imported fields:

- symbol, status (open/closed)
- entry_price, entry_date
- shares, stop_loss, profit_target
- highest_since_entry, trailed_stop_loss
- closed_at, closed_price, closed_reason

---

## Index data (separate step)

Index CSVs are **not** migrated via `migrate:php`. Use:

```bash
pnpm sync:indices
```

This reads from `../stock-verifier/data/indices/` by default.

---

## PHP feature mapping

| PHP feature | Script Screener equivalent |
|-------------|---------------------------|
| `screener.php` | `/screener` — [SCREENER.md](SCREENER.md) |
| `stock-details.php` | Planned `/stock/:symbol` — [STOCK-DETAILS.md](STOCK-DETAILS.md) |
| `verify.php` | `/verify` + `POST /api/v1/verify/auto` — [CFA-VERIFY.md](CFA-VERIFY.md) |
| `index.php` (Full Verify) | Planned `/verify/full` — [FULL-VERIFY.md](FULL-VERIFY.md) |
| `swing-scan.php` | `/swing` + `POST /api/v1/swing/scan` |
| `swing-auto.php` | `/swing/auto` — [SWING-AUTO.md](SWING-AUTO.md) |
| `nifty-15m.php` / `intraday-app.php` | `/intraday` — [INTRADAY.md](INTRADAY.md) |
| `nifty-positions.php` | Planned — [NIFTY-POSITIONS.md](NIFTY-POSITIONS.md) |
| `morning-dashboard.php` | Planned `/morning` — [MORNING-ROUTINE.md](MORNING-ROUTINE.md) |
| `trading-presets.php` | Planned `/presets` — [TRADING-PRESETS.md](TRADING-PRESETS.md) |
| `strategies.php` | Planned `/strategies` — [TRADING-STRATEGIES.md](TRADING-STRATEGIES.md) |
| `admin.php` uploads | `/admin` |
| `DataCache` (SQLite) | Redis `sv:*` keys |
| `swing_positions.json` | `swing_positions` table |
| `watchlist.json` | `watchlist_items` table |
| Session auth | JWT login |
| `SV_ADMIN_KEY` | Same env var, `x-admin-key` header |

---

## Verification after migration

```bash
# Check watchlist count
psql $DATABASE_URL -c "SELECT COUNT(*) FROM watchlist_items;"

# Check positions
psql $DATABASE_URL -c "SELECT status, COUNT(*) FROM swing_positions GROUP BY status;"

# Check verify history
psql $DATABASE_URL -c "SELECT COUNT(*) FROM verification_runs;"
```

Log in to the web app and verify:

- Watchlist page shows imported symbols
- Positions page shows open/closed trades
- Verify history appears on Verify page

---

## Running alongside PHP (transition period)

Both apps can share:

- PostgreSQL (different databases recommended)
- Redis (use different DB numbers — SV uses DB 1)
- Index CSV source folder

Do **not** run both apps writing to the same JSON files. After migration, treat PostgreSQL as the source of truth.

---

## Re-running migration

The migrator uses upserts where possible:

- Watchlist items: upsert by watchlist + symbol
- Positions: upsert by position ID
- Verify runs: creates new rows (may duplicate if re-run)

Safe to re-run watchlist/positions migration; verify history may duplicate.
