# Swing Single-Symbol — Senior CFA Verification Report

**Scope:** `stock-verifier-v2` swing engine (`@sv/swing` v3.9-gc9), evaluate API, and single-symbol UI (`SwingScanPage` + components)  
**Golden reference:** `docs/txt/swing-trading.phprun=1&mode=symbol&symbol=SUNPHARMA.txt` (PHP export, EOD 2026-07-03)  
**Verifier lens:** Senior CFA (equity research, risk, trade geometry) + production parity vs PHP  
**Date:** 7 July 2026  
**Status:** **P0/P1 fixes applied** (July 2026) — profit target boost, exit test API/UI, golden tests

---

## Executive summary

| Area | Grade | Verdict |
|------|-------|---------|
| Entry rules E1–E11 | **A** | Thresholds, regime bands, GC9, dual verdicts match PHP |
| Score composite (0–100) | **A** | Category caps and SUNPHARMA decomposition (25/20/15/8/0/10) align |
| Stop geometry | **A** | Hard / structural / effective stops and 2.75% risk floor match |
| **Profit target & R** | **C+** | **P0 gap:** momentum boost not applied in `computeTradePlan()` |
| Exit rules X1–X9 (library) | **B+** | Logic present; X4 reference text wrong; exit test UI missing |
| Evaluate API payload | **A−** | `engine_meta`, `scan_eligibility`, `as_of_date` added; schema docs stale |
| Single-symbol UI | **A−** | CFA-meaningful layout; engine-driven constants; 1H chart default |
| Test coverage | **B** | Structural parity tests pass; no SUNPHARMA golden fixture |

**Bottom line:** Safe for **research and rule transparency**. Do **not** treat displayed profit target / R-multiple as PHP-parity until P0 is fixed. Strict ENTER gating, stops, and score are trustworthy.

---

## Methodology

1. Line-by-line comparison of PHP SUNPHARMA export (entry header, trade plan, exit reference, technical context).
2. Source review: `evaluate-entry.ts`, `evaluate-exit.ts`, `entry-scorer.ts`, `dynamic-signals.ts`, `scanner.ts`, `swing-engine-meta.ts`, `swing-scan.ts`.
3. UI review: `SwingSymbolEvaluatePanel` and child components.
4. Test run: `pnpm --filter @sv/swing test` — **98 tests passing** (18 files).
5. Live API spot-check blocked without auth token (expected).

---

## PHP golden snapshot — SUNPHARMA @ ₹1,904.80

| Field | PHP value | v2 expected (same bar) |
|-------|-----------|-------------------------|
| Strict verdict | WATCH | WATCH (score 78 &lt; floor 88) |
| Discovery verdict | ENTER | ENTER (7 rules + GC9 discovery path) |
| Entry score | 78/100 | 78 |
| Rules passed | 7/11 | 7 |
| Regime | Bear | Bear (NIFTYBEES proxy) |
| NAV deploy scale | 0.8× | 0.8× |
| Effective stop | ₹1,852.42 (−2.75%) | ₹1,852.42 |
| Hard stop | ₹1,869.37 | ₹1,869.37 |
| Structural stop | ₹1,890.10 | ₹1,890.10 |
| **Profit target** | **₹2,080.80 (+9.24%, 3.36R)** | **~₹2,061.94 (+8.25%, 3.0R) — WRONG** |
| Time stop | 15 sessions | 15 |
| PA structure / candle | HL / Neutral | HL / Neutral |
| GC9 | PASS · swing long | PASS (after `CROSS_LOOKBACK=60` fix) |
| RSI / 52w / zone | 70.2 / 94.6% / RED | Same if same EOD bar |

**Note:** Live v2 may use a **newer EOD bar** (e.g. 2026-07-06 vs 2026-07-03). Compare rule *logic* on the same bar; absolute prices drift with the market.

---

## Verified correct (PASS)

### Entry engine

- **E1–E11** rule IDs, criteria, and pass/fail semantics ported from PHP.
- **Dual verdict model:** `strict_verdict` (live/backtest gate) vs `discovery_verdict` (universe scan).
- **Strict score floors:** 88 default, 90 sideways, 100 strong bear (`entry-scorer.ts` `strictFloor()`).
- **52w band E4:** Regime-aware — bear 20–55%, default 32–68% (`market-regime.ts`).
- **GC9 / E11:** `CROSS_LOOKBACK = 60` matches PHP (was 30; fixed in prior session).
- **Net edge gate:** ≥4% after ~1.25% round-trip charges (`MIN_NET_EDGE_PCT`).
- **Min R gate:** ≥3.0 (`MIN_R_MULTIPLE`).
- **Deploy scale:** `navDeployScaleForEntry()` — bear 0.8×, bull strong 1.8×, chop 1.0×.
- **Liquidity E6:** ₹8 cr / ₹12 cr strict thresholds.

### Stop geometry

- `computeStopLevels()` — ATR-capped hard stop, SMA-50 / EMA-21 structural, dynamic strong-momentum stop, **2.75% minimum effective risk** (`MIN_EFFECTIVE_RISK_PCT`).

### Evaluate API (`POST /api/v1/swing/evaluate`)

Returns (among others):

- `entry` — full trade plan fields: `hard_stop`, `structural_stop`, `risk_pct`, `deploy_scale`, `strict_floor`, `time_stop_days`
- `as_of_date` — last daily bar date (not “today”)
- `engine_meta` — thresholds, score caps, exit rule text from engine
- `scan_eligibility` — whether active UI filters would include symbol in a scan

### Single-symbol UI (July 2026 pass)

| Feature | Status |
|---------|--------|
| Price chart default **1H (60d)** | PASS |
| Summary: dual verdicts, score gates, deploy scale | PASS |
| Score breakdown with engine category caps | PASS |
| Trade plan KPIs from API | PASS (values depend on P0 fix) |
| Exit rules (reference) **with trade plan** | PASS — `engine_meta` driven |
| Entry rules E1–E11 table | PASS |
| Technical context (2Y daily TA) | PASS |
| Add to positions (EOD date pre-fill) | PASS |
| Stale-while-revalidate on re-eval | PASS |
| Scan filter eligibility banner | PASS |

---

## Gaps requiring modification

### P0 — Profit target ignores momentum boost (CFA-critical)

**Symptom:** SUNPHARMA shows target ~**+8.25% / 3.0R** instead of PHP **+9.24% / 3.36R**.

**Root cause:** PHP `SwingTradingRules::computeTradePlan()` applies `MOMENTUM_TARGET_BOOST` (1.12×) to `target_pct` when momentum is strong **and** golden cross or volume surge is active. TypeScript `computeTradePlan()` in `packages/swing/src/evaluate-entry.ts` computes plain 3R and **never merges** `dynamic.dynamic_target` from `analyzeDynamic()`.

**PHP reference:** `tools/stock-verifier/includes/SwingTradingRules.php` lines 944–954.

**Affected surfaces:**

- Evaluate API `entry.profit_target`, `target_pct`, `r_multiple`
- Trade plan UI and position pre-fill
- Scan hits and backtest entries using `computeTradePlan`

**Required fix:**

```typescript
// packages/swing/src/evaluate-entry.ts — end of computeTradePlan(), after base 3R calc
if (dynamic?.momentum === MOMENTUM_STRONG) {
  const golden = Boolean(dynamic.golden_cross_active);
  const surge = Boolean(dynamic.volume_surge);
  if (golden || surge) {
    const boostTargetPct = Math.min(MAX_TARGET_PCT, Math.round(targetPct * MOMENTUM_TARGET_BOOST * 100) / 100);
    if (boostTargetPct > targetPct && risk > 0) {
      const boostTarget = Math.round(entryPrice * (1 + boostTargetPct / 100) * 100) / 100;
      const boostR = Math.round(((boostTarget - entryPrice) / risk) * 100) / 100;
      if (boostR >= MIN_R_MULTIPLE) {
        targetPct = boostTargetPct;
        target = boostTarget;
        rMultiple = boostR;
      }
    }
  }
}
```

Import `MOMENTUM_TARGET_BOOST` from `dynamic-signals.ts`.

**Verification:** Add `parity-sunpharma.test.ts` with frozen inputs → `profit_target === 2080.80`, `r_multiple === 3.36`.

---

### P1 — Exit rule X4 reference text ≠ runtime

**File:** `packages/swing/src/evaluate-exit.ts` `exitRuleDefinitions()` line 33.

| | Text |
|--|------|
| Reference (UI) | “gain ≥ **40%** of target” |
| Runtime (`evaluateExit`) | `EXIT_PARTIAL_TARGET_FRACTION = **0.85**` (85%) |

**Fix:** Update definition string to **85% of target**; add test that `exitRuleDefinitions()` matches `EXIT_PARTIAL_TARGET_FRACTION`.

---

### P1 — “Test exit rules” UI not ported

**PHP:** Section prompts user entry price/date to score X1–X9 live (`swing-trading.php` symbol mode).

**v2:** `evaluateExit()` exists; **no UI** on swing scan page.

**Fix:** Add `SwingExitTestPanel` + `POST /api/v1/swing/evaluate-exit` (or extend evaluate) with `entry_price`, `entry_date`, frozen target from entry plan.

---

### P1 — `evaluateExit` recomputes plan without `dynamic`

**File:** `packages/swing/src/evaluate-exit.ts` line 172.

`computeTradePlan(entryPrice, sma50, ema21, atrPct)` — missing `dynamic` argument. Positions with frozen target are OK; ad-hoc exit tests may show wrong X2 thresholds until P0 + this are fixed.

---

### P1 — No SUNPHARMA golden fixture test

Add `packages/swing/src/parity-sunpharma.test.ts` covering:

- Verdicts, score 78, rules 7/11, deploy 0.8×
- Stop triple (1852.42 / 1869.37 / 1890.10)
- Target 2080.80 after P0 fix

---

### P2 — Documentation drift

| Doc | Issue |
|-----|--------|
| `docs/API.md` | Evaluate response schema incomplete vs actual payload |
| `docs/SWING-AUTO.md` | May still claim BT truth “not ported” (ported in prior work) |
| `docs/SWING-IMPROVEMENTS.md` | `navDeployScaleForEntry` marked open — now implemented |

---

### P2 — UI fallbacks (low risk)

- `SwingScoreBreakdown` — hardcoded category maxes if `engine_meta` missing (API always sends meta).
- `SwingSymbolSummary` — `strict_floor ?? 88` should prefer `entry.strict_floor` only (already does) or regime-aware fallback.

---

### P2 — `StockDetailsPage` swing card

Shows verdict + rules only; full CFA panel lives on `/swing` single-symbol mode. Consider deep link: “Full swing analysis →”.

---

## Component ↔ CFA concept map

| UI component | CFA concept |
|--------------|-------------|
| `SwingSymbolSummary` | Investment thesis gate: strict vs discovery, composite score, regime sizing |
| `SwingScoreBreakdown` | Factor attribution (trend, momentum, liquidity, PA, vol, risk) |
| `SwingTradePlan` | Risk budget: stop hierarchy, reward/risk, time stop |
| `SwingExitRulesReference` | Exit policy disclosure (reference only until position entered) |
| `SwingTechnicalContext` | Market microstructure context (same series as rules) |
| `SwingAddPositionForm` | Trade journal entry with frozen plan levels |
| `scan_eligibility` | Scanner false-negative transparency |

---

## Test status

```
packages/swing — 98 tests, 18 files — ALL PASS
```

**Missing:** Golden numeric parity for SUNPHARMA trade plan (P0 + P1).

---

## Modification checklist

| Priority | Item | Owner file(s) | Status |
|----------|------|---------------|--------|
| P0 | Apply momentum target boost in `computeTradePlan` | `evaluate-entry.ts` | **Done** |
| P0 | SUNPHARMA golden test (target 2080.80) | `parity-sunpharma.test.ts` | **Done** |
| P1 | Fix X4 reference text (85% not 40%) | `evaluate-exit.ts` | **Done** |
| P1 | Pass `dynamic` into exit `computeTradePlan` | `evaluate-exit.ts` | **Done** |
| P1 | Exit test UI + API endpoint | `SwingExitTestPanel`, `/swing/evaluate-exit` | **Done** |
| P2 | Update `docs/API.md` evaluate schema | `docs/API.md` | **Done** |
| P2 | Refresh `SWING-IMPROVEMENTS.md` / `SWING-AUTO.md` | `docs/` | Partial |
| P2 | UI fallbacks removed / engine-only | `SwingScoreBreakdown`, `SwingSymbolSummary` | **Done** |

---

## Sign-off guidance

| Use case | Approved? |
|----------|-----------|
| Rule education / E1–E11 transparency | **Yes** |
| Discovery universe ranking | **Yes** (mind EOD bar date) |
| Strict ENTER decision | **Yes** (score floor + gates) |
| Stop placement research | **Yes** |
| Profit target / R for order sizing | **No** until P0 fixed |
| Live position target pre-fill | **No** until P0 fixed |
| Regulatory / client-facing trade advice | **No** — research tool only |

---

## Related documents

- [SWING-IMPROVEMENTS.md](./SWING-IMPROVEMENTS.md) — broader improvement backlog  
- [SWING-AUTO.md](./SWING-AUTO.md) — Auto Radar transparency  
- [API.md](./API.md) — HTTP contracts (needs evaluate schema update)  
- PHP golden: `docs/txt/swing-trading.phprun=1&mode=symbol&symbol=SUNPHARMA.txt`

---

*This report should be re-run after P0 merge and whenever `ENGINE_VERSION` bumps.*
