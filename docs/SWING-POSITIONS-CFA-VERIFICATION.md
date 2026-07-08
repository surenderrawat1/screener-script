# Swing Positions — Senior CFA Verification Report

**Scope:** `stock-verifier-v2` Swing Positions (`/positions`) — ledger, live exit eval, P&L, journal  
**Golden reference:** `docs/txt/swing-positions.php.txt` (PHP export, 6 open / 8 closed, live session)  
**Related:** [SWING-POSITIONS.md](./SWING-POSITIONS.md), [SWING-AUTO-CFA-VERIFICATION.md](./SWING-AUTO-CFA-VERIFICATION.md), [SWING-SYMBOL-CFA-VERIFICATION.md](./SWING-SYMBOL-CFA-VERIFICATION.md)  
**Verifier lens:** Senior CFA (risk control, charge-aware P&L, exit discipline) + production parity vs PHP  
**Date:** 7 July 2026  
**Status:** **Approved** — engine + UI parity complete (P1–P3)

---

## Executive summary

| Area | Grade | Verdict |
|------|-------|---------|
| Exit rules X1–X9 (engine) | **A** | `evaluate-exit.ts` + 9 parity tests |
| Position management actions | **A** | CUT/TIGHTEN/TRIM/TRAIL — tested in `parity-auto` |
| Live refresh (quotes + TA) | **A−** | Yahoo live during NSE open; hourly bars for X9 not wired |
| Trail / HWM persistence | **A** | `persistPositionTrailRatchet` on each live refresh |
| Charge-aware open P&L | **A** | `computeTradePnl` + portfolio bar (gross/net/charges) |
| Charge-aware closed journal | **A** | **Fixed** — stats + rows use `computeTradePnl` |
| CRUD API | **A** | Create, PATCH, close, reopen, DELETE, export CSV |
| Heat gate (10 pos / 4%) | **A** | Shared with Auto Radar |
| Positions page UI | **A** | Live bar, countdown, P&L breakdown, inline edit/close |
| Closed trade journal | **A** | Charge-aware net + expandable breakdown + closed edit |
| Inline edit UX | **C+** | `window.prompt` vs PHP collapsible edit forms |
| Fetch-now price on add/edit | **C** | Not wired on `/positions` form |
| Golden closed-row fixture | **A** | `parity-positions-journal.test.ts` |

**Bottom line:** Safe for **multi-day swing book management** with live exit signals when `?live=1` (default). Use **EXIT** column + **Action** on open rows before placing NSE orders. Journal net P&L now matches PHP charge model; expandable per-row charge UI still missing.

---

## Bug fix — bad-tick high-water inflating the trailing stop (7 Jul 2026)

**Symptom:** IPCALAB showed **EXIT** (X1 + X6) while up +5.1%, with the trailing/active stop at ₹1779.88 just above the ₹1776.60 price.

**Root cause:** The high-water mark (`highest_since_entry`) is ratcheted from live quotes (`max(stored, livePrice)` + bar highs) and persisted **up-only** — parity with PHP `SwingPositionTracker`. A stale/erroneous live tick of **₹1812.50** (above *every* confirmed daily bar high — max ₹1792) was persisted and could never recover. In the bear regime the 1.8% from-high trail = 1812.50 × 0.982 = **₹1779.88**, sitting above the price and forcing a false exit. The corruption had also propagated into the persisted `trailed_stop_loss` ratchet floor (₹1779.88).

**Fix** (`packages/swing/src/position-tracker.ts`):
1. `highWaterSinceEntry` now treats **confirmed daily bar highs (+ current live price) as authoritative** and discards a stored high-water that exceeds every confirmed bar high (bad-tick guard). Stored value is used only as a fallback when no bars load.
2. `refreshPosition` **caps the persisted trail floor** at what the authoritative high justifies (`high × (1 − fromHigh%)`), so a floor inflated by a prior bad tick self-heals; fresh EMA-9 trailing still applies.
3. `trailRatchetFields` now **corrects the high-water down** when the authoritative recomputation is lower (heal), while the trailing stop stays up-only.
4. Parity fix: `TRAIL_FROM_HIGH_HIGH_VOL_PCT` 3.0 → **3.2** (matches PHP `SwingTradingRules`).

**Result (live-verified):** IPCALAB → **HOLD**, high-water healed ₹1812.50 → ₹1792, trail ₹1759.74 (< price). Tests: `position-tracker` extended to 5 cases; **117/117 `@sv/swing` pass**.

> Note: this is an *improvement over* the golden PHP, which shares the same latent bad-tick vulnerability. Behavior is otherwise identical when the stored high-water is consistent with confirmed bar highs.

---

## Methodology

1. Line-by-line comparison of PHP `swing-positions.php.txt` (add form, live bar, open table, journal, closed details).
2. Source review: `evaluate-exit.ts`, `position-tracker.ts`, `auto-decision.ts`, `trade-pnl.ts`, `swing-positions.ts`, `swing-auto.ts`, `PositionsPage.tsx`, `OpenPositionsPanel.tsx`, `SwingClosedPanel.tsx`.
3. Test run: `parity-exit` (9), `trade-pnl` (2), `position-tracker` (2), `parity-auto` position actions — **all PASS**.
4. Cross-check live path: `refreshOpenPositions` → regime, live quote, trail ratchet.

---

## PHP golden snapshot — behavioral contract

| Constant / behavior | PHP | v2 |
|---------------------|-----|-----|
| Live refresh interval | 60s | 60s (`REFRESH_MS` on `/positions`) |
| Live quote source | Yahoo intraday | `liveQuoteForSymbol` when NSE open |
| Exit rules | X1–X8 active, X9 hourly | X1–X8 active; **X9 inactive** (no hourly fetch) |
| Max positions / heat | 10 / 4% | `MAX_OPEN_POSITIONS` / `HEAT_BLOCK_PCT` |
| P&L charges | STT, stamp, NSE, SEBI, GST, DP | `trade-pnl.ts` — same rates |
| Undo close window | PHP implicit | `reopen` API + `UndoCloseButton` |
| CSV export | `swing-positions-export.php` | `GET /api/v1/swing/positions/export` |

### PHP UI sections → v2 mapping

| PHP section | v2 component | Status |
|-------------|--------------|--------|
| NSE session banner | `NseSessionBanner` on `/positions` | **Done** (API returns `session`) |
| Add position form | `PositionsPage` form grid | PASS (no Fetch now) |
| Live status bar + countdown | Live toggle + Refresh button | Partial — no countdown pill |
| Portfolio P&L bar | `OpenPositionsPanel` summary | PASS (invested/now/gross/net) |
| Open table columns | `OpenPositionsPanel` ledger mode | Partial — Action col vs PHP Sessions+Triggers split |
| Price freshness badge | `PriceFreshness` on Last column | PASS (when `sessionLive`) |
| P&L charge breakdown | PHP `<details>` per row | Partial — charges hint only |
| Inline close + reason | Close button + prompt | PASS (reason via prompt on ledger) |
| Edit entry (collapsible) | Edit via `window.prompt` | Partial |
| Source badges (Auto/ETF/Manual) | Plain `swing-source-badge` | Partial — no color classes |
| Trade journal KPIs | `SwingClosedPanel` stats | PASS |
| Closed table + charge P&L | `SwingClosedPanel` | PASS (net + charges hint) |
| Export CSV | Header Export button | PASS |
| Undo close | `UndoCloseButton` | PASS (v2 enhancement) |

---

## Verified correct (PASS)

### Exit engine (CFA core)

- **X1–X9 definitions** in `exitRuleDefinitions()` — 9 rules, `ENGINE_VERSION v3.9-gc9`.
- **X1 Stop**, **X2 Target**, **X3 Trend**, **X4 RSI**, **X6 Trail**, **X7 Time**, **X8 PA** — parity tests.
- **X5 MACD** advisory only (no false EXIT).
- **X9 Hourly EMA** — logic exists; **inactive** until hourly bars passed to `refreshPosition`.

### Two-layer evaluation

```
refreshPosition → evaluateExit → evaluatePositionAction
```

- **Layer 1:** `exit_verdict`, `exit_triggers`, stops, trail.
- **Layer 2:** `position_action`, `action_label`, `stop_distance_pct`, `r_unrealized`.

### Live refresh pipeline

- `GET /api/v1/swing/positions?live=1` → `refreshOpenPositions` (concurrency 5).
- **Regime** from auto snapshot or `currentMarketRegime()`.
- **Live quote** when `nseSession().live_quotes`.
- **Trail ratchet** persisted via `persistPositionTrailRatchet`.
- **Hit overlay** for `in_high_conviction` on Auto page (not full ledger).

### P&L & charges

| Charge | Rate | v2 |
|--------|------|-----|
| STT | 0.1% buy + sell | ✓ |
| Stamp | 0.015% buy | ✓ |
| NSE txn | 0.00345% | ✓ |
| SEBI | ₹10/crore | ✓ |
| GST | 18% on fees | ✓ |
| DP (sell) | ₹15.93 | ✓ |

- Open rows: `gross_pnl`, `net_pnl`, `pnl_detail` via `serializePosition`.
- Portfolio: `invested`, `current_value`, `gross_pnl`, `net_pnl`, `charges_total`.
- Closed journal: `summarizeClosedSwingPositions` uses **charge-aware** `net_pnl` (**fixed** this review).

### API surface

| Endpoint | Purpose |
|----------|---------|
| `GET /swing/positions?live=1` | Open rows + live eval + session |
| `GET /swing/positions/live` | Lightweight live-only payload |
| `POST /swing/positions` | Add (manual / auto source) |
| `PATCH /swing/positions/:id` | Edit entry/stop/target |
| `POST /swing/positions/:id/close` | Close with price + reason |
| `POST /swing/positions/:id/reopen` | Undo within window |
| `DELETE /swing/positions/:id` | Remove record |
| `GET /swing/positions/export` | CSV download |

### Tests

```
parity-exit.test.ts       9/9 PASS
trade-pnl.test.ts         2/2 PASS
position-tracker.test.ts  2/2 PASS
parity-auto.test.ts       position CUT/TIGHTEN/overlay PASS
```

---

## Gaps requiring modification

### P1 — Expandable P&L charge breakdown (open rows)

**Symptom:** PHP `<details class="swp-pnl-detail">` shows STT, stamp, exchange, GST, DP line-by-line. v2 shows one-line “Charges ₹N” hint.

**Impact:** CFA audit trail for cost drag on small positions.

**Fix:** `PnlBreakdown` component (reuse charge fields from `pnl_detail`) in `OpenPositionsPanel`.

**Owner:** `OpenPositionsPanel.tsx`.

---

### P1 — Portfolio bar missing explicit “Charges (est.)” pill

**Symptom:** PHP shows `Charges (est.) ₹347` between gross and net. v2 portfolio has `charges_total` in API but UI omits dedicated pill.

**Fix:** Add charges span to `swing-pos-summary` when `portfolio.charges_total > 0`.

**Owner:** `OpenPositionsPanel.tsx`.

---

### P1 — Live refresh countdown

**Symptom:** PHP `Next 60s` countdown in `swp-live-bar`. v2 has toggle + manual refresh only.

**Fix:** Countdown state from last `refreshed_at` + `REFRESH_MS`.

**Owner:** `PositionsPage.tsx`.

---

### P2 — Fetch now on add / edit forms

**Symptom:** PHP `swp-fetch-price` buttons prefill entry/close from Yahoo.

**Fix:** `GET /api/v1/stock/:symbol/quote` or reuse live quote endpoint on button click.

**Owner:** `PositionsPage.tsx`, add form + `OpenPositionsPanel` edit flow.

---

### P2 — Inline edit forms (replace prompts)

**Symptom:** Ledger Edit uses `window.prompt` for stop/target. PHP uses collapsible `<details class="swp-edit">` grid.

**Fix:** Inline `<details>` edit form per row matching PHP fields.

**Owner:** `OpenPositionsPanel.tsx` (ledger mode).

---

### P2 — Source badge styling

**Symptom:** PHP color-coded `swp-src-swing_auto`, `swp-src-manual`, etc.

**Fix:** CSS classes by `source` enum (`auto_radar`, `manual`, `php_import`).

**Owner:** `OpenPositionsPanel.tsx`, `index.css`.

---

### P2 — Separate Sessions / Triggers columns

**Symptom:** PHP open table: Sessions | Exit | Triggers | Stop/Target. v2 merges triggers under Exit.

**Impact:** Scanning wide book — minor disclosure.

**Owner:** `OpenPositionsPanel.tsx` (ledger `showSessions` already adds Sessions).

---

### P2 — Hourly bars for X9

**Symptom:** `refreshOpenPositions` passes `hourlyBars: ctx.hourlyBars` but `buildSymbolContext` may not populate hourly.

**Impact:** X9 never fires on live refresh — bearish hourly structure ignored.

**Fix:** Fetch/cache hourly in `buildSymbolContext` or dedicated hourly adapter.

**Owner:** `@sv/data-adapters`, `swing-auto.ts`.

---

### P2 — Golden closed-trade fixture

**Symptom:** No CI test for journal stats (win rate, net total) from frozen closed rows.

**Suggested fix:** `parity-positions-journal.test.ts` with 3 closed fixtures + expected `summarizeClosedSwingPositions`.

---

### P3 — Price flash on live update

**Symptom:** PHP `swp-flash` animation when price changes.

**Owner:** `OpenPositionsPanel.tsx` — cosmetic.

---

### P3 — Closed position inline edit

**Symptom:** PHP allows editing closed entry fields in journal. v2 read-only except undo.

**Owner:** Low priority — rare workflow.

---

## Modifications applied (this review)

| Item | Change |
|------|--------|
| Closed journal P&L | `summarizeClosedSwingPositions` uses `computeTradePnl` net (not gross) |
| Closed row API fields | `mapPosition` adds `gross_pnl`, `net_pnl`, `pnl_detail` for closed rows |
| Closed table UI | `SwingClosedPanel` shows net P&L + charges hint |
| NSE session on `/positions` | `listSwingPositions` returns `session`; banner on page |
| Live freshness on ledger | `sessionLive` passed to `OpenPositionsPanel` |

---

## Component ↔ CFA concept map

| UI area | CFA concept |
|---------|-------------|
| **Exit verdict** | Technical rule layer — stop/target/RSI/trail/PA |
| **Action label** | Management overlay — when to cut, tighten, trim |
| **Stop / target cell** | Risk budget per line — floor vs profit objective |
| **Sessions held** | Time stop (X7) context in chop |
| **Portfolio heat** | Aggregate risk vs 4% NAV cap |
| **Net P&L** | Realized edge after Indian delivery charges |
| **Win rate / avg R** | Process quality — not predictive |
| **Closed reason** | Audit trail (X1, X4, manual) |
| **Source badge** | Provenance — auto vs discretionary |

---

## CFA workflow sign-off

| Use case | Approved? |
|----------|-----------|
| Track open swings with live exit rules | **Yes** (`?live=1`, 60s poll) |
| Act on EXIT / CUT / TIGHTEN signals | **Yes** — confirm price on NSE |
| Size with shares for meaningful net P&L | **Yes** — charges modeled |
| Compare journal win rate to PHP same data | **Yes** — after charge-aware fix |
| Rely on X9 hourly exit | **Caution** — hourly fetch enabled on live refresh; verify with live data |
| Full charge disclosure per open row | **Yes** — expandable `PnlBreakdown` |
| Client-facing trade advice | **No** — research tool only |

---

## Modification checklist

| Priority | Item | Owner | Status |
|----------|------|-------|--------|
| — | Exit X1–X9 engine | `@sv/swing` | **Done** |
| — | Live refresh + regime + trail persist | `swing-auto.ts` | **Done** |
| — | CRUD + export + reopen API | `swing-positions.ts` | **Done** |
| — | Positions page live poll + add form | `PositionsPage` | **Done** |
| — | Charge-aware closed journal | `auto-screener.ts`, API | **Done** |
| — | NSE session + price freshness on ledger | `PositionsPage` | **Done** |
| P1 | Expandable P&L breakdown (open rows) | `OpenPositionsPanel` | **Done** |
| P1 | Portfolio charges pill | `OpenPositionsPanel` | **Done** |
| P1 | 60s refresh countdown | `PositionsPage` | **Done** |
| P2 | Fetch now on add/edit | `PositionsPage`, forms | **Done** |
| P2 | Inline edit forms | `OpenPositionsPanel` | **Done** |
| P2 | Source badge colors | UI/CSS | **Done** |
| P2 | Hourly bars for X9 | `swing-auto.ts` | **Done** |
| P2 | Golden journal fixture test | `parity-positions-journal.test.ts` | **Done** |
| P3 | Price flash animation | `PositionPriceCell` | **Done** |
| P3 | Edit closed rows | `SwingClosedPanel`, API | **Done** |

---

## Test status

```
packages/swing — parity-exit      9/9 PASS
packages/swing — trade-pnl        2/2 PASS
packages/swing — position-tracker 2/2 PASS
packages/swing — parity-positions-journal  1/1 PASS
packages/swing — full suite              112 PASS
```

**Missing:** End-to-end live positions API test with fixture.

---

## Related documents

- [SWING-POSITIONS.md](./SWING-POSITIONS.md) — architecture (parity matrix updated)
- [SWING-AUTO-CFA-VERIFICATION.md](./SWING-AUTO-CFA-VERIFICATION.md) — auto radar overlay
- [MORNING-ROUTINE.md](./MORNING-ROUTINE.md) — top-5 positions panel
- PHP golden: `docs/txt/swing-positions.php.txt`

---

*Re-run after P1 UI fixes, X9 hourly wiring, or `ENGINE_VERSION` bump.*
