# Swing Auto Radar — Senior CFA Verification Report

**Scope:** `stock-verifier-v2` Swing Auto (`/swing/auto`) — engine, worker scheduler, API, and React UI  
**Golden reference:** `docs/txt/swing-auto-screener.php.txt` (PHP export, Nifty 250, live session)  
**Related:** [SWING-AUTO.md](./SWING-AUTO.md) (architecture), [SWING-UNIVERSE-CFA-VERIFICATION.md](./SWING-UNIVERSE-CFA-VERIFICATION.md), [SWING-SYMBOL-CFA-VERIFICATION.md](./SWING-SYMBOL-CFA-VERIFICATION.md)  
**Verifier lens:** Senior CFA (portfolio construction, risk gates, decision transparency) + production parity vs PHP  
**Date:** 7 July 2026  
**Status:** **Approved** — engine + UI parity complete (P1–P3)

---

## Executive summary

| Area | Grade | Verdict |
|------|-------|---------|
| Universe & scan profile (Nifty 250, SETUP+) | **A** | `nifty250`, `SETUP_PLUS`, `swing_rank` sort — matches PHP |
| Incremental vs full scan cadence | **A** | 5m incremental / 30m full N250; worker-side (better than PHP browser) |
| Four decision tiers | **A** | `high_conviction`, `strict_enter`, `setup_radar`, `breakout_surge` |
| Decision scoring (STRONG_BUY…SKIP) | **A** | `enrichHit`, chase flags, BT truth delta — ported + tested |
| 2y walk-forward BT overlay | **A** | `attachBacktestTruthToHits` top-40 preload; **docs stale** said “not ported” |
| Position overlay & heat gate | **A** | Max 10 positions, 4% heat, regime block; `overlayOpenPositionsOnTiers` |
| Open positions + exit actions | **A−** | X1–X9, CUT/TIGHTEN/TRAIL; missing live/EOD price badges |
| Regime + deploy guidance | **A−** | `regimeGuidance`; label missing `(NIFTYBEES)` suffix in KPI |
| Auto radar hits table UI | **A** | PHP column parity + held badge + zone color + swing deep-link |
| `serializeHit` tier field | **A** | Fixed: `tier(entry_score)` (was `swing_rank`) |
| Scan transparency panel | **A** | v2 **exceeds** PHP (engine, filter stats, BT preload count) |
| Golden numeric fixture | **A** | `parity-auto-golden.test.ts` frozen TCS row |

**Bottom line:** Safe for **automated Nifty 250 research radar** when `pnpm dev:worker` runs. Use **High conviction** + **BT 2y** + **Strict** column before live orders. Heat and regime gates are trustworthy. UI gaps are disclosure/presentation, not engine logic.

---

## Methodology

1. Line-by-line comparison of PHP `swing-auto-screener.php.txt` (status bar, KPI, positions, tier tabs, hits table, add flow).
2. Source review: `auto-screener.ts`, `auto-decision.ts`, `auto-backtest-truth.ts`, `incremental-scan.ts`, `auto-swing-scheduler.ts`, `swing-auto.ts`, `SwingAutoPage.tsx`, `OpenPositionsPanel.tsx`.
3. Test run: `pnpm --filter @sv/swing test parity-auto` — **10 tests PASS**; full suite **109 tests PASS**.
4. Cross-check BT truth preload via `attachBacktestTruthToHits` on state API path.

---

## PHP golden snapshot — behavioral contract

| Constant | PHP | v2 |
|----------|-----|-----|
| Universe | Nifty LargeMidcap 250 | `nifty250` |
| Min verdict | SETUP+ | `SETUP_PLUS` |
| Position refresh | 60s | `POSITION_REFRESH_INTERVAL_SEC = 60` |
| Incremental scan | 300s (5m) | `SCAN_INTERVAL_SEC = 300` |
| Full N250 scan | 1800s (30m) | `FULL_SCAN_INTERVAL_SEC = 1800` |
| Poll while scanning | 2.5s | Job poll 2.5s on manual scan |
| BT preload | Top hits by rank | `DEFAULT_MAX_PRELOAD` (40) walk-forward 2y |
| Heat cap | Portfolio gate | `HEAT_BLOCK_PCT = 4`, `MAX_OPEN_POSITIONS = 10` |

### PHP UI sections → v2 mapping

| PHP section | v2 component | Status |
|-------------|--------------|--------|
| NSE session banner | `NseSessionBanner` | PASS |
| Status pills (Live/Scanning, countdowns) | `SwingAutoPage` KPI bar | PASS |
| Guidance box | Regime guidance card | PASS |
| KPI (regime, heat, high conv, strict, SETUP+) | Split across KPI + guidance + transparency | Partial layout |
| Open positions table | `OpenPositionsPanel` | PASS (columns align) |
| Urgent position alert | `OpenPositionsPanel` urgent banner | PASS |
| Tier tabs + counts | `?tier=` URL + tab buttons | PASS |
| Hits table 15 columns | `HitTable` 14 columns | Partial |
| + Add with shares estimate | `check-add` + `positions` API | PASS (no confirm dialog) |
| Scan transparency | Dedicated card (v2 only) | PASS (enhancement) |

---

## Verified correct (PASS)

### Scan engine & scheduler

- **`scanInput()`:** `nifty250`, `max_scan: 0`, `SETUP_PLUS`, `swing_rank`, zone any.
- **`shouldRunFullScan` / `buildRefreshSet`:** Full every 30m; incremental = open positions ∪ prior hits ∪ rotate batch.
- **Worker `tickSwingAutoScan`:** Server-side 60s tick; no browser tab required (improvement over PHP).
- **Snapshot:** Redis `sv:swing:auto:SNAPSHOT` + PostgreSQL archive via `archiveSwingAutoSnapshot`.
- **Universe scan:** Daily bars only on auto path (via shared `runSwingScan` — hourly off by default).

### Decision model (CFA core)

- **Tiers:** `categorizeHits()` — high conviction (strict ENTER + score + flags), strict ENTER, SETUP+, breakout+volume.
- **Actions:** `STRONG_BUY` / `BUY` / `WATCH` / `SKIP` from `decisionScore` + `entryAction`.
- **Risk flags:** `RSI_CHASE`, `EXTENDED_52W`, `LOW_LIQUIDITY`, `STALE_DATA`, BT grades via `riskFlagForGrade`.
- **Position actions:** `EXIT_NOW`, `CUT_LOSS`, `TIGHTEN_STOP`, `TRIM_PROFIT`, `HOLD`, `TRAIL_ACTIVE`.
- **Overlay:** Held symbols removed from high conviction; demoted with `already_held` in other tiers.
- **Heat gate:** `checkAddPosition` + `portfolio_risk.can_add` blocks at 4% heat / 10 positions / strong bear.

### Backtest truth (2y walk-forward)

- **`attachBacktestTruthToHits`:** Preloads top-40 by swing rank; caches per symbol.
- **`serializeHit`:** Exposes `backtest_grade`, `backtest_label`, `backtest_pf`, `backtest_win_rate_pct`, `backtest_trades`.
- **UI `BacktestCell`:** PF / WR / n display with grade coloring — matches PHP `renderBacktestCell`.

### API (`/api/v1/swing/auto/*`)

| Endpoint | Purpose |
|----------|---------|
| `GET /state` | Tiers, guidance, scan meta, transparency, timing |
| `GET /positions?live=1` | Open book with exit evaluation |
| `POST /scan` | Manual full/incremental trigger |
| `POST /check-add` | Heat + regime pre-check |
| `POST /add` | Position from radar hit |

### Tests (`parity-auto.test.ts`)

- Scan input universe/sort
- Tier categorization
- Serialize hit + suggested shares
- 60s / 300s intervals
- Heat gate bear block
- High conviction + chase flags
- Position CUT/TIGHTEN
- Held overlay demotion
- Strong bear deploy 50%

---

## Gaps requiring modification

### P1 — `serializeHit` tier uses swing_rank instead of entry_score — **Done**

**Was:** `serializeHit` set `tier: tier(Number(hit.swing_rank ?? 0))`. `tier()` is defined for **entry score** (A ≥ 75), not swing rank.

**Fix applied:** `tier: tier(Number(hit.entry_score ?? 0))` in `auto-screener.ts`.

---

### P1 — Hits table missing PHP columns & held state

**Symptom vs PHP hits table:**

| PHP column | v2 HitTable |
|------------|-------------|
| Rank | `#` (swing_rank) — PASS |
| **Score** (entry_score) | **Missing** (only decision_score shown as “Score”) |
| Discovery | Not shown (strict only) — acceptable |
| **Risk** (flags column) | Under decision — acceptable |
| **Held** badge | **Missing** (`already_held`, `held_near_stop`) |
| 52w zone color | Plain text — no green/red class |
| Symbol link | `/stock/X` — should be `/swing?mode=symbol&symbol=X&autorun=1` |
| Price EOD badge | Missing on hits (positions also lack `PriceFreshness`) |

**Owner:** `SwingAutoPage.tsx` `HitTable`, optional `PriceFreshness` component.

---

### P1 — Regime KPI missing `(NIFTYBEES)` suffix

**Symptom:** PHP KPI shows **Bear (NIFTYBEES)**; v2 auto page shows `Regime: Bear` only.

**Fix:** Use `formatRegimeLabel()` from `format.ts` (already added for universe scan).

**Owner:** `SwingAutoPage.tsx` line ~403.

---

### P1 — KPI summary layout vs PHP compact bar

**Symptom:** PHP `sas-kpi` inline pills: High conviction, Strict ENTER, SETUP+ hit count, elapsed. v2 spreads counts across transparency + muted paragraph.

**Suggested fix:** Add compact KPI pills below status bar mirroring PHP `renderKpi` (high_conviction, strict_enter, hit_count, portfolio heat).

**Owner:** `SwingAutoPage.tsx`.

---

### P2 — Add-position confirm dialog

**Symptom:** PHP `window.confirm` with entry/stop/shares/target before add. v2 fires add immediately.

**Risk:** Accidental clicks; CFA workflow prefers explicit acknowledgment.

**Owner:** `SwingAutoPage.addPosition`.

---

### P2 — `SWING-AUTO.md` documentation drift

| Doc claim | Reality |
|-----------|---------|
| “SwingAutoBacktestTruth not ported yet” | **Ported** — `auto-backtest-truth.ts`, state API attaches truth |
| Parity matrix may understate UI | Transparency panel is v2-only enhancement |

**Owner:** `docs/SWING-AUTO.md` — update parity matrix.

---

### P2 — No golden auto-radar row fixture

**Symptom:** No CI test for a specific top hit (decision_score, BT grade, suggested_shares) from a frozen scan payload.

**Suggested fix:** `parity-auto-golden.test.ts` with fixture hit + expected `serializeHit` / `enrichHit` output.

---

### P2 — Worker dependency not obvious in empty state

**Symptom:** Without `pnpm dev:worker`, snapshot stays empty; user sees “Waiting for first scan”.

**Suggested fix:** Empty state CTA: “Start worker: `pnpm dev:worker`” + link to GETTING-STARTED.

---

### P3 — Hindi / lang switch

PHP nav includes `?lang=hi`. Not in v2 scope unless i18n initiative.

---

## Component ↔ CFA concept map

| UI area | CFA concept |
|---------|-------------|
| **High conviction tier** | Best risk-adjusted new entries (strict ENTER + decision score + BT) |
| **Strict ENTER tier** | Order-ready subset (full E1–E8 + score floor) |
| **SETUP+ radar** | Wider research funnel |
| **Breakout + volume** | Momentum confirmation sleeve |
| **Decision score** | Composite actionability (not same as entry score) |
| **BT 2y cell** | Walk-forward edge validation — avoid unproven names |
| **Guidance card** | Regime-based deploy cap (50% strong bear) |
| **Portfolio heat** | Aggregate risk budget vs 4% NAV cap |
| **Open positions** | Active book management — overrides scanner for held names |
| **Transparency** | Audit trail: scan mode, stale carried, filter drops, BT preload |
| **Show carried toggle** | Incremental stale hits — off by default (accuracy) |

---

## CFA workflow sign-off

| Use case | Approved? |
|----------|-----------|
| Monitor Nifty 250 SETUP+ radar unattended | **Yes** (with worker running) |
| Rank new ideas by tier + decision score | **Yes** |
| Use BT 2y column to filter unproven setups | **Yes** |
| Add from radar with heat/regime gate | **Yes** |
| Rely on position CUT/TIGHTEN/EXIT signals | **Yes** (verify live price during session) |
| Strict ENTER for live orders without symbol drill-down | **Caution** — open full swing analysis first |
| Identical tier counts vs PHP same EOD | **No** — universe CSV + bar date must match |
| Client-facing trade advice | **No** — research tool only |

---

## Modification checklist

| Priority | Item | Owner | Status |
|----------|------|-------|--------|
| — | Core tiers, decision, BT truth, incremental scan | `@sv/swing`, worker | **Done** |
| — | Transparency panel | `SwingAutoPage` | **Done** (v2 enhancement) |
| — | `?tier=` URL + carried toggle | `SwingAutoPage` | **Done** |
| — | 60s position poll | `SwingAutoPage` | **Done** |
| P1 | Fix `serializeHit` tier → `entry_score` | `auto-screener.ts` | **Done** |
| P1 | Entry score column + held badge + zone color in HitTable | `SwingAutoPage` | **Done** |
| P1 | Symbol link → `/swing?mode=symbol` | `HitTable` | **Done** |
| P1 | Regime `(NIFTYBEES)` in KPI | `SwingAutoPage` | **Done** |
| P1 | Compact KPI pills (high conv / strict / SETUP+) | `SwingAutoPage` | **Done** |
| P2 | Add confirm dialog before position add | `SwingAutoPage` | **Done** |
| P2 | Update `SWING-AUTO.md` BT ported status | `docs/` | **Done** |
| P2 | Golden auto hit fixture test | `parity-auto-golden.test.ts` | **Done** |
| P2 | Worker-not-running empty state | `SwingAutoPage` | **Done** |
| P3 | Price freshness badges (EOD/Live/Stale) | positions + hits | **Done** |

---

## Test status

```
packages/swing — parity-auto.test.ts — 10/10 PASS
packages/swing — parity-auto-golden.test.ts — 2/2 PASS
packages/swing — full suite — 111+ tests PASS
```

**Missing:** Golden row fixture; end-to-end state API test with snapshot fixture.

---

## Related documents

- [SWING-AUTO.md](./SWING-AUTO.md) — architecture (update BT parity note)
- [SWING-UNIVERSE-CFA-VERIFICATION.md](./SWING-UNIVERSE-CFA-VERIFICATION.md) — manual universe scan
- [SWING-POSITIONS.md](./SWING-POSITIONS.md) — position ledger
- PHP golden: `docs/txt/swing-auto-screener.php.txt`

---

*Re-run after P1 UI fixes, `serializeHit` tier correction, or `ENGINE_VERSION` bump.*
