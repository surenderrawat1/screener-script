# Swing Auto Radar — CFA Rules Compliance Verification

**Scope:** Swing Auto Radar (`/swing/auto`) vs CFA swing trading rulebook (E1–E11, GC9, X1–X9, R≥3, portfolio heat)  
**Engine:** `@sv/swing` **v3.9-gc9**  
**Related:** [SWING-AUTO.md](./SWING-AUTO.md) · [SWING-AUTO-CFA-VERIFICATION.md](./SWING-AUTO-CFA-VERIFICATION.md) (PHP UI parity) · [SWING-SYMBOL-CFA-VERIFICATION.md](./SWING-SYMBOL-CFA-VERIFICATION.md)  
**Verifier lens:** Senior CFA — equity research, trade geometry, risk budgeting, process discipline  
**Date:** 3 August 2026 (high-accuracy update applied)  
**Status:** **Approved for high-accuracy live Add** — Ch.93 gate + deploy sizing + incremental hourly E9

---

## Executive summary

| Area | Grade | Verdict |
|------|-------|---------|
| Entry engine behind scan (E1–E11 / GC9) | **A** | Same `evaluateEntry()` as symbol/universe scan |
| Dual verdict funnel (discovery vs strict) | **A** | SETUP+ radar + Strict ENTER tier correctly separated |
| Decision tiers + BT 2y overlay | **A−** | High conviction correctly requires strict + R-ok |
| Portfolio heat / max positions / 1% risk size | **A** | Heat 4% / 10 names / 1% sizing use user-configured NAV |
| Regime gate (strong bear) | **A** | Blocks new adds + guidance deploy caps |
| Exit book (X1–X9 on open positions) | **A−** | Live refresh uses hourly for X9; overlay CUT/TRIM are extra |
| **Live Add from radar vs Ch.93 strict gate** | **A** | `add_allowed` + `checkAddPosition` require strict ENTER / R / net edge; `research_add=1` opt-in |
| **Position sizing vs deploy scale** | **A** | `deploy_scale` × guidance `deploy_pct` and user NAV applied |
| **E9 hourly confirmation on scan** | **A** | Full and incremental scans both load hourly confirmation |

**Bottom line:** Safe as an **unattended Nifty 250 research radar** and for **live Add from High conviction / Strict ENTER**. SETUP / Breakout Add requires explicit **Research Add** (`?research_add=1`). Prefer opening `/swing?mode=symbol` before size when session is live.

---

## Methodology

1. Rulebook mapping: E1–E11 (`evaluate-entry.ts`), X1–X9 (`evaluate-exit.ts`), heat (`portfolio-risk.ts`), auto decision (`auto-decision.ts` / `auto-screener.ts`).
2. Compare Auto Radar Add path vs symbol Add (`SwingAddPositionForm`) — same book, different gates.
3. Trace scan path: `scanInput()` → `executeAutoScanPlan` → `runSwingScan` (hourly off) → `buildState` / `checkAddPosition`.
4. Position path: `refreshOpenPositions` → `refreshPosition` + `evaluateExit` (hourly on) → `evaluatePositionAction`.
5. Tests: `pnpm --filter @sv/swing test` — **117/117 PASS** (3 Aug 2026).

---

## Swing rulebook — what Auto Radar must honour

| Rule family | Spec (engine) | Auto Radar obligation |
|-------------|---------------|------------------------|
| **E1–E11** | Trend, pullback, MACD, 52w band, extension, liquidity, EMA stack, PA, dynamic, EMA-21 guard, GC9 | Scan must score every candidate with same engine |
| **Strict ENTER** | Score ≥ regime floor + E1/E6/E7 + R≥3 + net edge + PA + quality/GC9 | Live Add should require this (or high conviction) |
| **Discovery SETUP+** | Wider funnel for research | OK for radar tabs; not for blind live Add |
| **R-multiple** | ≥ **3.0** after stop geometry | Flag LOW_R; block live Add when `r_multiple_ok === false` |
| **Net edge** | Target − ~1.25% charges ≥ **4%** | Symbol form enforces; Auto Add does not |
| **Stops / targets** | Hard / structural / effective; 3R (+ momentum boost) | Hit plan must come from `computeTradePlan` |
| **X1–X9** | Stop, target, trend, RSI, MACD, trail, time, PA, hourly | Open book must evaluate on refresh |
| **Risk budget** | ≤ **1%** NAV / trade; ≤ **4%** heat; ≤ **10** opens | `canOpenPosition` + suggested shares |
| **Regime** | Strong bear → `blocks_strict_enter` | Block new entries; reduce deploy |
| **Deploy scale** | Bear 0.8× / chop 1.0× / bull strong 1.8× | Size should scale; guidance % should bind |

---

## Verified correct (PASS)

### 1. Same entry engine as Ch.93 scanner

`scanInput()` → Nifty 250, `SETUP_PLUS`, `swing_rank`. `executeAutoScanPlan` calls `runSwingScan` → `evaluateEntry()` for each symbol. Discovery and strict verdicts, entry score, stop/target/R, and E1–E11 rule rows are the same library used on `/swing` symbol mode.

### 2. Tier model matches rulebook intent

| Tier | Rule interpretation |
|------|---------------------|
| `high_conviction` | Live-ready sleeve: STRONG_BUY **or** BUY≥72 + strict ENTER + R-ok + no STALE/LOW_R/BACKTEST_FAIL |
| `strict_enter` | Order-ready filter: `strict_verdict === 'ENTER'` |
| `setup_radar` | Research funnel: discovery ENTER/SETUP |
| `breakout_surge` | Momentum sleeve: swing-high break + vol ≥ 1.08× |

Held names removed from high conviction; other tiers mark `already_held` / `add_allowed: false`.

### 3. Decision overlays respect chase / quality flags

Auto decision correctly penalizes / blocks:

- RSI > 72 (`RSI_CHASE`)
- 52w > 88% (`EXTENDED_52W`)
- `r_multiple_ok !== true` (`LOW_R`)
- Stale incremental (`STALE_DATA`)
- BT FAIL/WEAK grades
- Strong bear without strict ENTER

### 4. Portfolio heat gate (book risk)

`checkAddPosition` + `portfolio_risk.can_add`:

- Max **10** open positions  
- Heat block at **4%** of NAV  
- Per-trade risk cap **1%** via `suggestedShares`  
- Strong bear (`blocks_strict_enter`) → no new adds  

### 5. Open-position exit path (X1–X9)

`refreshOpenPositions` builds context with **`include_hourly: true`**, so X9 (hourly EMA bearish) can fire. Trail ratchet persists. Overlay actions (EXIT / CUT / TIGHTEN / TRIM / TRAIL / HOLD) sit on top of `exit_verdict` correctly for book management.

### 6. Trade plan geometry (post–P0)

`computeTradePlan` sets a **frozen 3R** profit target, clamped to **+7%–+25%**. Momentum boost is intentionally disabled so the entry target does not drift. Auto radar hits inherit that plan from the scan engine; open positions keep the stored `profit_target` for X2.

### 7. Incremental accuracy discipline

Default tiers use **fresh hits only**; carried rows flagged `incremental_stale` and treated as stale in `enrichHit`. Open symbols always in refresh set.

---

## Gaps requiring modification

### P0 — Auto Add bypasses strict Ch.93 live-order gate — **Done**

**Fix applied (3 Aug 2026):**

- `liveAddGateReasons` / `isLiveAddAllowed` — strict ENTER + `r_multiple_ok` + net edge + not SKIP/stale/held
- `serializeHit.add_allowed` uses live gate; `research_add_allowed` for SETUP journal
- `checkAddPosition` enforces live gate server-side; `research_add: true` opt-in bypass
- UI: Research Add toggle (`?research_add=1`); Addable filter respects gate; confirm shows deploy scale

---

### P1 — Suggested shares ignore deploy scale / regime deploy % — **Done**

**Fix applied:** `suggestedSharesForHit` multiplies base 1% risk by `deploy_scale` × (`deploy_pct` / 100). `serializeHit` / `checkAddPosition` pass regime guidance.

---

### P1 — Auto scan omits hourly bars (E9 incomplete) — **Done (incremental)**

**Fix applied:** Incremental auto scan sets `include_hourly: true`. Full N250 remains daily-only for cost; transparency exposes `hourly_on_scan`.

---

### P2 — Overlay CUT (−4%) vs X1 hard stop (−5% / dynamic)

**Observation:** `evaluatePositionAction` issues `CUT_LOSS` at **−4%** after ≥2 sessions even if X1 active stop not hit. Hard stop default is **5%** (ATR-capped). This is a **stricter management overlay (M1)**, not a bug — but it is not named in exit-rule definitions (X1–X9).

**Status:** **Done.** M1 is a soft management review at 12 sessions; X7 remains the hard 15-session sideways time stop. The earlier review does not itself force an X7 exit.

---

### P2 — User-configured portfolio NAV

Heat percentage and share size now read the authenticated user's Swing NAV setting, with ₹10 lakh retained only as the initial default.

**Applied modification:** `getSwingPortfolioNav` supplies state heat, hit sizing and server-side check-add. Swing Auto exposes **Set portfolio NAV**.

**Owner:** settings service + `swing-auto.ts` / `auto-screener.ts`  
**Status:** **Done**

---

### P2 — Entry date on Auto Add uses calendar “today” — **Done**

**Fix applied:** When session is not live-quote, `entry_date` defaults to `hit.as_of_date`; otherwise calendar today.

---

### P3 — Documentation drift

| Doc | Issue |
|-----|--------|
| [SWING-AUTO-CFA-VERIFICATION.md](./SWING-AUTO-CFA-VERIFICATION.md) | PHP UI parity — cross-links this rules report |
| [SWING-AUTO.md](./SWING-AUTO.md) | Updated for BT ported + M1 overlay + high-accuracy Add |
| This report | Source of truth for **rules** compliance |

---

## Component ↔ rule map

| Auto Radar surface | Swing rule / CFA concept |
|--------------------|--------------------------|
| Scan engine | E1–E11 + GC9 discovery/strict |
| Strict ENTER tab | Live-order candidate list |
| High conviction tab | Best risk-adjusted new risk |
| Setup / Breakout tabs | Research / momentum sleeves (not live default) |
| Decision score / flags | Chase & quality overlay on top of entry score |
| BT 2y cell | Walk-forward edge filter |
| R / stop / target columns | Trade geometry (min 3R) |
| Guidance deploy % | Regime risk budget (must bind size — P1) |
| Heat / can_add | Aggregate book risk |
| Open positions panel | X1–X9 + management overlay M1 |
| Transparency card | Audit: mode, stale carried, BT preload |

---

## CFA workflow sign-off

| Use case | Approved? |
|----------|-----------|
| Unattended Nifty 250 SETUP+ monitoring (worker on) | **Yes** |
| Rank ideas by high conviction / strict / BT | **Yes** |
| Manage open book with CUT/TIGHTEN/EXIT signals | **Yes** (confirm live price in session) |
| One-click Add from **Setup** or **Breakout** as live Ch.93 entry | **No** — use Research Add only for journal |
| One-click Add from **High conviction / Strict** | **Yes** — Ch.93 gate enforced; still open symbol chart when live |
| Treat suggested shares as final size in all regimes | **Yes** (scaled); override if NAV ≠ ₹10L default |
| Client-facing trade advice | **No** — research / journal tool only |

---

## Modification checklist

| Priority | Item | Owner | Status |
|----------|------|-------|--------|
| P0 | Align `add_allowed` + `checkAddPosition` with strict ENTER / R / net edge | `auto-screener.ts` | **Done** |
| P0 | Disable Add on setup/breakout unless research mode | `SwingAutoPage.tsx` | **Done** |
| P0 | Tests: SETUP hit cannot add; strict ENTER + R-ok can | `parity-auto.test.ts` | **Done** |
| P1 | Apply `deploy_scale` × guidance `deploy_pct` to suggested shares | `auto-screener.ts` | **Done** |
| P1 | Hourly on full and incremental auto scans + transparency flag | `auto-swing-scan.ts` | **Done** |
| P2 | Document M1 −4% cut overlay; align time-stop policy | docs + `auto-decision.ts` | **Done** |
| P2 | User NAV for heat/sizing | settings + API + Swing Auto UI | **Done** |
| P2 | Auto Add `entry_date` ← `as_of_date` when EOD | `SwingAutoPage.tsx` | **Done** |
| P1 | High-accuracy BT win rate ≥70% profitable trades | `auto-backtest-truth.ts`, live/high-conviction gates | **Superseded** — soft diagnostic only |
| P1 | Economic-edge primary gate (E → CAGR → DD → PF) | `auto-backtest-truth.ts`, live/high-conviction/paper | **Done** |
| P3 | Fix BT note in `SWING-AUTO.md`; cross-link this report | docs | **Done** |

---

## Test status (after economic-edge update)

```
packages/swing — economic-edge primary gate tests
Includes: high-accuracy-win-rate.test.ts — WR soft; economic edge primary
packages/data-adapters — swing paper candidate reasons use economic edge
```

### Live sample (2y strict-ENTER, non-overlapping X1–X9 trades) — 6 Aug 2026

| Symbol | Mode | Signals | Win rate | Pass ≥70%? |
|--------|------|---------|----------|------------|
| INFY | SETUP+ | 15 | 6.7% | No |
| RELIANCE | SETUP+ | 73 | 39.7% | No |
| HDFCBANK | SETUP+ | 73 | 35.6% | No |
| RELIANCE | ENTER | 50 | 42% | No |
| HDFCBANK | ENTER | 30 | 40% | No |
| SUNPHARMA | ENTER | 42 | 38.1% | No |

**Current operational result:** Bear regime, 93 unique radar names, 27 strict ENTER names, **0 proven High Conviction**, and **0 live/paper eligible**. Of the 93 names, 21 have an unproven strict-ENTER sample and 72 have no strict-ENTER backtest evidence. No trade is the correct result.

**CFA note:** Executable gate is now **economic-edge first** (expectancy, compound, max DD, PF). Soft WR remains diagnostic. Missing and unproven samples cannot enter High Conviction.
---

## Related documents

- [SWING-AUTO.md](./SWING-AUTO.md) — architecture & cadence  
- [SWING-AUTO-CFA-VERIFICATION.md](./SWING-AUTO-CFA-VERIFICATION.md) — PHP UI parity (July 2026)  
- [SWING-SYMBOL-CFA-VERIFICATION.md](./SWING-SYMBOL-CFA-VERIFICATION.md) — E1–E11 / trade plan  
- [SWING-POSITIONS-CFA-VERIFICATION.md](./SWING-POSITIONS-CFA-VERIFICATION.md) — journal & exits  
- PHP golden: `docs/txt/swing-auto-screener.php.txt`

---

*Re-run this verification after an `ENGINE_VERSION` bump or a material entry/exit-rule change.*
