# Swing Trading & Auto Radar — CFA Verification & Improvement Plan

**Reviewer lens:** Senior CFA (equity research, portfolio risk) + Senior Developer (PHP parity, production safety)  
**Engine:** `@sv/swing` v3.11-lite · E1–E12 entry (soft catalysts) · X1–X9 exit  
**Updated:** August 2026

---

## Executive summary

The swing **analysis engine** and **Auto Radar** are production-ready for research use. Phase 1–3 parity gaps for entry, exits, Auto Radar truth, and portfolio-gated universe backtests are closed.

**v3.11-lite (over-rule cleanup):** E7 no longer vetoes on short-EMA stack alone; E9/E10/E12 are soft or style-scoped; discovery/strict ENTER no longer re-AND the full E-ladder or require dynamic volume; SETUP+ sorts by `swing_rank`; X1 no longer double-counts trail with X6; `min_rules_passed` counts hard E1–E8 only (max 8).

| Area | Grade | Notes |
|------|-------|-------|
| Entry rules E1–E12 | **A** | Hard E1–E8 · Soft E9–E12 · `min_rules_passed` = hard only |
| Exit rules X1–X9 | **A** | X1 hard/BE only; X6 owns trail — no double-fire |
| Auto Radar tiers | **A** | BT truth overlay, deploy scale, stale penalties |
| Portfolio risk | **A** | Heat gate live + `applyPortfolioGates` in multi-symbol BT |
| PHP parity | **A−** | Gates + walk-forward; NAV compound sim still PHP-only |
| UI completeness | **A** | E1–E12 + X1–X9; Nifty 250 batch backtest |

---

## What is verified correct

### Operator guide — hard vs soft (v3.11-lite)

| Tier | Rules | Role |
|------|-------|------|
| **Hard** | E1–E8 | Risk/structure — drive score, filters, and Strict ENTER readiness |
| **Soft** | E9–E12 | Catalysts / style — advisory or strategy-scoped (`require_rules`) |

**How to use the scanner**
- Default SETUP+: discovery ENTER/SETUP, ranked by `swing_rank` (not raw rule count)
- **Min hard rules:** optional 1–8 on E1–E8 only — do not set ≥9
- **Stratzy:** strategy `swing_ma20_stratzy` or Require rules = E12 (hard pass = pullback to SMA-20)
- **GC9 only:** use the GC9 filter / `gc9_only` — E11 is soft on the checklist
- Strict ENTER ≠ “12/12 rules” — it is score floor + liquidity + PA + R/net-edge + core trend

**Paper Stratzy proof (intraday):** wallet auto uses `ma20_stratzy`; proof scorecard needs ≥5 Stratzy closes.

---

### Entry engine (`evaluate-entry.ts`)

- **E1–E12** with E3 MACD turning-up vs prior session
- **v3.11-lite:** E7 = EMA primary trend (short stack confirmatory); E9 soft unless weak momentum; E10 soft when E2 pullback OK; E11/E12 optional catalysts / Stratzy `require_rules`
- Regime-aware E4 52w band; hourly E9 advisory on scan
- Strict vs discovery verdicts without double-gating the full rule card; 3R + net-edge gate
- `navDeployScaleForEntry` (bull 1.8× / bear 0.8× / chop)

### Auto Radar

- Tiers: `high_conviction`, `strict_enter`, `setup_radar`, `breakout_surge`
- `SwingAutoBacktestTruth` — top-40 walk-forward grades (STRONG/OK/WEAK/FAIL)
- Grades feed `decisionScore`, `entryAction`, `isHighConviction`
- Incremental stale → `STALE_DATA` penalty

### Exit & positions

- Live refresh: regime + hourly bars + HWM from bar highs
- Trail ratchet persisted (up only)
- `exit_rules[]` on position API; expandable X1–X9 table on Open Positions
- Charge-aware PnL (`trade-pnl.ts`) on open/closed summaries

### Backtest (`/swing/backtest`)

- E1–E11 signal collection + filters
- **Exit simulation:** stop (X1), target (X2), `evaluateExit` rules, time stop (X7)
- Non-overlapping trades, cooldown, charge-aware net P&L
- **Universe batch:** Nifty 250 (and other universes), up to 50 symbols
- **`applyPortfolioGates`:** chronological max 10 opens / 4% heat across symbols

---

## Implementation status

### Phase 1 — Safety & wiring ✅

- [x] Regime + hourly on position refresh
- [x] HWM from bars since entry
- [x] Persist trail ratchet (DB)
- [x] E3 MACD turning up
- [x] Incremental stale penalty
- [x] Positions ledger hit/regime context
- [x] Server-side regime on check-add
- [x] Exit rules in position API

### Phase 2 — PHP parity ✅

- [x] `SwingAutoBacktestTruth` → grade top 40 hits
- [x] Wire backtest flags into `decisionScore` / `isHighConviction`
- [x] `navDeployScaleForEntry` on `suggestedShares`
- [x] `SwingRulesTable` (E1–E11 / X1–X9) on Open Positions panel

### Phase 3 — Research tooling ✅

- [x] Backtest with exit simulation (stop / target / X rules)
- [x] Multi-symbol portfolio heat gates in backtest (`applyPortfolioGates`)
- [x] Universe backtest report (Nifty 250 batch UI, max 50 names)
- [x] Charge-aware closed PnL (ledger + simulated trades)

---

## CFA interpretation guide

### When is strict ENTER valid?

1. **E1 + E7** — Primary trend  
2. **E2 or proximity** — Not chasing (or E10 exception)  
3. **E4** — Not chasing 52w high in bear  
4. **E9** — Hourly EMA not bearish  
5. **Score ≥ floor** + **3R + net edge**  
6. Prefer **BT STRONG/OK** and win-rate gate ≥ 70% when proven

### Exit priority (live book)

1. **X1** stop → exit  
2. **X8/X9** structure/hourly with gain → trim/tighten  
3. **X4** RSI partial after ~85% of target path  
4. **X6** trail after 50% of target (ratchet persisted)

---

## Verification checklist

```bash
pnpm --filter @sv/swing test
# Auto radar: GET /api/v1/swing/auto/state?live=1
# Backtest:  POST /api/v1/swing/backtest {"symbol":"TCS","min_verdict":"SETUP_PLUS"}
```

1. Bear regime → E4 band tightens; strong bear blocks new adds  
2. Open position → expand **+** for X1–X9 table  
3. Live refresh → `trailed_stop_loss` only increases  
4. Backtest trades table shows exit_reason / triggers  
5. Universe batch (Nifty 250) → portfolio section shows accepted vs blocked by heat  

---

## Related docs

- [SWING-AUTO.md](SWING-AUTO.md)  
- [SWING-POSITIONS.md](SWING-POSITIONS.md)  
- [TRADING-PRESETS.md](TRADING-PRESETS.md)  
- [API.md](API.md)  
