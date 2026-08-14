# Intraday Paper Wallet (Test Environment)

**Purpose:** Fund ₹1,00,000 paper capital and auto enter/exit **liquid stock** intraday trades during the live NSE session. Records are append-only in PostgreSQL for audit proof.

## Defaults (chosen)

| Setting | Value |
|---------|-------|
| Opening fund | ₹1,00,000 |
| Universe | 12 liquid NSE stocks only (no indices / F&O) |
| Max notional / trade | ₹30,000 |
| Max open positions | 10 |
| Risk / trade | ≤1% of equity (stop distance), then notional cap |
| Heat cap | 4% |
| Daily loss kill | −2% realized day P&L |
| Fills | Latest bar close + 5 bps slippage |
| Accuracy / backtest gate | **Skipped** (current-session charts only) |
| Automation | Off until **Arm**; worker ticks every 60s |

## API

| Method | Path | Action |
|--------|------|--------|
| GET | `/api/v1/intraday/paper/wallet` | Wallet + open/closed-today + ledger |
| POST | `/api/v1/intraday/paper/fund` | Ensure wallet + ₹1L funding ledger (once) |
| POST | `/api/v1/intraday/paper/arm` | `{ "armed": true\|false }` |
| POST | `/api/v1/intraday/paper/tick` | Manual tick (same as worker) |
| POST | `/api/v1/intraday/paper/positions/:id/close` | Manual paper close (rejects index/ETF scale mix-ups) |
| POST | `/api/v1/admin/intraday/repair-closed-books` | Void scale-mismatched closes + flatten leftover journal |

## DB tables

- `paper_wallets` — cash, reserved, realized, `auto_armed`
- `paper_ledger_entries` — immutable funding / buy / pnl rows
- `paper_orders` + `paper_fills` — idempotent `client_order_id`
- `paper_positions` — open/closed with strategy `evidence` JSON

## UI

`/intraday/positions` → **Paper wallet (test)** panel: fund, arm, tick, open/closed tables.

## Ops

1. `pnpm db:push` (applies Prisma schema)
2. Restart `pnpm dev:all` (API + worker)
3. Open `/intraday/positions` → **Ensure ₹1L fund** → **Arm auto-trade**
4. During NSE open (09:15–14:30 IST), worker scans and manages exits. **Hard time stop is 14:30 IST** (`EXIT_TIME`); leftover journal rows from a prior session are flattened `EXIT_SESSION` at a compatible mark (or entry).
5. Yahoo fallback must not cache `NIFTYBEES.NS` (~₹280) as Nifty 50 (~₹24,000). Closes whose mark is >20% away from entry are rejected; existing corrupt rows are voided to flat at entry (`VOID_SCALE_MISMATCH`) with an append-only `adjustment` ledger.

Educational paper trading only — not a live broker.
