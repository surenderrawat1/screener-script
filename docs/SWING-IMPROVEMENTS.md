# Swing Trading & Auto Radar — CFA Verification & Improvement Plan

**Reviewer lens:** Senior CFA (equity research, portfolio risk) + Senior Developer (PHP parity, production safety)  
**Engine:** `@sv/swing` v3.9-gc9 · E1–E11 entry · X1–X9 exit  
**Date:** July 2026

---

## Executive summary

The swing **analysis engine** is sound: E1–E11, strict vs discovery verdicts, 3R targets, regime-aware 52w bands, and tiered Auto Radar match the PHP design intent. The main gaps are **live position management** (regime/hourly not wired on refresh, trail ratchet not persisted) and **PHP overlays** (backtest truth, NAV deploy scale) not yet ported.

| Area | Grade | Notes |
|------|-------|-------|
| Entry rules E1–E11 | **A−** | Unified across scan/evaluate/backtest; E3 MACD “turning up” fixed in this pass |
| Exit rules X1–X9 | **B+** | Library complete; live refresh was missing hourly E9 + regime |
| Auto Radar tiers | **A** | Four tiers + decision scoring; hit normalization fixed |
| Portfolio risk | **B** | Heat gate works; deploy scale vs regime still display-only |
| PHP parity | **B+** | BT truth + walk-forward ported; momentum target boost fixed (Jul 2026) |
| UI completeness | **B+** | E1–E11 on scan/details; exit rules on positions improved |

---

## What is verified correct

### Entry engine (`evaluate-entry.ts`)

- **E1** Trend: Price ≥ SMA-50 ≥ SMA-200, 200+ bars
- **E2** Pullback: RSI 42–54 or within 2.5% of SMA-50 / EMA-21
- **E4** 52w band: Regime-adjusted (`bear` 20–55%, default 32–68%)
- **E7/E11** EMA stack + GC9 state machine
- **Verdicts:** `strict_verdict` (ENTER/WATCH/AVOID) vs `discovery_verdict` (ENTER/SETUP/WATCH)
- **Strict ENTER** requires score floor, E1/E6, PA, 3R, net edge after charges

### Scanner & filters (`scanner.ts`, `entry-filters.ts`)

- `min_verdict`, `zone_52w`, `gc9_only`, `breakout_volume`
- `min_rules_passed`, `require_rules` (e.g. E1 + E11)
- Hourly bars for **E9** on scan path
- `currentMarketRegime()` on all scan/evaluate paths

### Auto Radar (`auto-decision.ts`, `auto-screener.ts`)

- Tiers: `high_conviction`, `strict_enter`, `setup_radar`, `breakout_surge`
- Decision actions: STRONG_BUY / BUY / WATCH / SKIP
- Position overlay: held symbols demoted; high conviction excludes open lots
- Worker scheduler: 5m incremental / 30m full N250 (no browser required)

### Exit engine (`evaluate-exit.ts`)

- X1 hard/breakeven/trail stop
- X2 3R target (frozen at entry)
- X3 trend break, X4 RSI partial, X5 MACD advisory, X6 trail, X7 time stop, X8 PA, X9 hourly EMA
- Unit tests: `parity-exit.test.ts`

---

## Issues found (prioritized)

### P0 — Live position safety (fixed in this pass)

| ID | Issue | Impact | Fix |
|----|-------|--------|-----|
| P0-1 | `refreshOpenPositions` omitted regime + hourly bars | X9 dead; X3/X6/X7 wrong; chop TRIM never fires | Pass `regime` + `ctx.hourlyBars` into `refreshPosition` → `evaluateExit` |
| P0-2 | Trail ratchet not persisted | Stops reset after restart | Update `highestSinceEntry` / `trailedStopLoss` on live refresh (ratchet up only) |
| P0-3 | HWM from price only, not bar highs | X6 trail too loose | Walk daily bars since `entry_date` for session highs |

### P1 — Parity & scoring (partially fixed)

| ID | Issue | Status |
|----|-------|--------|
| P1-1 | E3 ignored “MACD turning up” vs prior bar | **Fixed** — `priorMacdHistogram(bars)` |
| P1-2 | `incremental_stale` hits not penalized | **Fixed** — treat as `stale` in `enrichHit` |
| P1-3 | `findHitMatch` omitted regime | **Fixed** |
| P1-4 | Positions ledger live path: no hits/regime | **Fixed** — snapshot hits + regime on `/positions` |
| P1-5 | Client-sent regime on check-add | **Fixed** — server resolves from snapshot / NIFTYBEES |
| P1-6 | Exit rules not in position API | **Fixed** — `exit_rules[]` on serialize |
| P1-7 | `SwingAutoBacktestTruth` (top-40 overlay) | **Open** — Phase 2 |
| P1-8 | `navDeployScaleForEntry` (bull/chop sizing) | **Done** — `evaluate-entry.ts` + evaluate API |

### P2 — Polish (backlog)

- Full walk-forward backtest with X1–X9 (not just signal replay)
- STT/DP charge-aware PnL on closed positions
- Per-hit `incremental_stale` badge on Auto Radar table rows
- Strategy registry copy: “E1–E8” → “E1–E11”
- Morning routine: re-enrich tiers from fresh regime

---

## CFA interpretation guide

### When is strict ENTER valid?

All must align:

1. **E1 + E7** — Primary trend (SMA + EMA stack)
2. **E2 or proximity** — Not chasing extended move (or GC9/momentum exception via E10)
3. **E4** — Not at 52w high in bear regime (chase risk)
4. **E9** — Hourly EMA not bearish (MTF confirmation)
5. **Score ≥ floor** (88 bull, 90 sideways, 100 strong bear blocked)
6. **3R + net edge** — Target covers ~1.25% round-trip + 4% minimum edge

**Example:** 8/11 rules pass with E2, E4, E9 failing → **WATCH/SETUP**, not ENTER. Do not size full position.

### Auto Radar tier usage

| Tier | Use |
|------|-----|
| **high_conviction** | STRONG_BUY or strict ENTER + score; size per heat gate |
| **strict_enter** | Strict ENTER verdict; confirm E2/E9 before add |
| **setup_radar** | SETUP+ discovery; watchlist / starter only |
| **breakout_surge** | Volume breakout; higher false-positive rate in bear |

### Exit priority (live book)

1. **X1** — Stop hit → exit (non-negotiable)
2. **X8/X9** — Structure/hourly deterioration with gain → trim or tighten
3. **X4** — RSI partial after 85% of target path
4. **X6** — Trail after 50% of target; ratchet must persist (P0-2)

---

## Implementation phases

### Phase 1 — Safety & wiring ✅ (this release)

- [x] Regime + hourly on position refresh
- [x] HWM from bars since entry
- [x] Persist trail ratchet (DB)
- [x] E3 MACD turning up
- [x] Incremental stale penalty
- [x] Positions ledger hit/regime context
- [x] Server-side regime on check-add
- [x] Exit rules in position API

### Phase 2 — PHP parity (next)

- [ ] Port `SwingAutoBacktestTruth` → grade top 40 hits (PASS/WEAK/FAIL)
- [ ] Wire backtest flags into `decisionScore` / `isHighConviction`
- [ ] `navDeployScaleForEntry` on `suggestedShares`
- [ ] `SwingExitRulesTable` on Open Positions panel (full UI)

### Phase 3 — Research tooling

- [ ] Backtest with exit simulation (PHP `SwingTradingBacktest` parity)
- [ ] Universe backtest report (Nifty 250 sample)
- [ ] Charge-aware closed PnL

---

## Verification checklist

```bash
# Unit tests
pnpm --filter @sv/swing test

# Single symbol evaluate (E1–E11 + regime)
curl -X POST /api/v1/swing/evaluate -d '{"symbol":"TCS"}'

# Auto radar state (tiers + positions)
curl /api/v1/swing/auto/state?live=1

# Walk-forward backtest
curl -X POST /api/v1/swing/backtest -d '{"symbol":"TCS","min_verdict":"SETUP_PLUS"}'
```

**Manual CFA checks:**

1. Bear regime → E4 band 20–55%; `blocks_strict_enter` on strong bear
2. Open position → `exit_rules` shows X1–X9 with active/advisory labels
3. After live refresh → `trailed_stop_loss` only increases in DB
4. Incremental scan → stale hits show `STALE_DATA` flag in tier scores

---

## Related docs

- [SWING-AUTO.md](SWING-AUTO.md) — Architecture & scheduler
- [SWING-IMPROVEMENTS.md](SWING-IMPROVEMENTS.md) — CFA verification & improvement plan
- [SWING-POSITIONS.md](SWING-POSITIONS.md) — Ledger & exit workflow
- [TRADING-PRESETS.md](TRADING-PRESETS.md) — Conservative swing / ETF presets
- [API.md](API.md) — `/swing/scan`, `/swing/evaluate`, `/swing/backtest`
