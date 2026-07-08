# Swing Universe Scan — Senior CFA Verification Report

**Scope:** `stock-verifier-v2` universe swing scanner — engine (`@sv/swing` v3.9-gc9), scan API, and universe UI (`SwingScanPage` + components)  
**Golden reference:** `docs/txt/swing-trading.phpscan_job_id=e052d595a19c0b28&mode=universe&universe=nifty500.txt` (PHP export, Nifty 500 SETUP+, EOD 2026-07-07)  
**Related:** [SWING-SYMBOL-CFA-VERIFICATION.md](./SWING-SYMBOL-CFA-VERIFICATION.md) (single-symbol / SUNPHARMA)  
**Verifier lens:** Senior CFA (equity research, portfolio construction, risk disclosure) + production parity vs PHP  
**Date:** 7 July 2026  
**Status:** **Universe UI/filter pass complete** — numeric golden parity and performance items remain open

---

## Executive summary

| Area | Grade | Verdict |
|------|-------|---------|
| Scanner filter logic (SETUP+, zone, GC9, breakout, rules) | **A** | Matches PHP `scanner.ts` / `matchesMinVerdict` semantics |
| Swing rank & tier on hits | **A−** | Formula ported; tier **letter** = entry score; workflow text should cite **swing_rank ≥ 70** |
| Scan form & filter UX | **A−** | PHP parity for universes, verdicts, sort, maxScan=0, background scan |
| Results KPI bar | **B+** | Core counts present; missing Source / Prefetch cache stats |
| Hits table (17 columns) | **A−** | All PHP columns; inline + Add; symbol deep-link |
| Trade plan on hits (stop/target/R) | **A** | Uses same `computeTradePlan()` as single-symbol (post P0 momentum fix) |
| Full-universe scale (Nifty 500) | **B** | Background jobs OK; sequential fetch + hourly bars add latency |
| Golden numeric parity (KIMS row) | **C** | No frozen fixture test vs PHP dump |
| Build / ops (`maxScan: 0`) | **B+** | Fixed in source; requires `@sv/shared` rebuild on deploy |

**Bottom line:** Safe for **SETUP+ universe research and ranking**. Strict ENTER column is the live-order gate. Do not treat hit counts as identical to PHP until the same EOD bar and universe CSV are loaded; logic parity is good, numeric parity is unproven at scale.

---

## Methodology

1. Line-by-line comparison of PHP Nifty 500 universe export (form, KPI bar, first hits rows).
2. Source review: `scanner.ts`, `ranker.ts`, `hit-normalizer.ts`, `runSwingScan()`, `createSwingScanJob()`, `SwingScanPage.tsx`, `SwingUniverseScanSummary.tsx`, `SwingUniverseHitsTable.tsx`.
3. Cross-check with single-symbol CFA report (trade plan P0 fixes apply to scan hits).
4. Test run: `pnpm --filter @sv/swing test` — **105 tests, 20 files — ALL PASS** (includes `scanner-summary.test.ts`).
5. Live Nifty 500 parity run not executed (requires auth + synced index constituents + same EOD as PHP).

---

## PHP golden snapshot — Nifty 500 SETUP+ (2026-07-07)

| KPI | PHP value | v2 expected (same inputs) |
|-----|-----------|---------------------------|
| Universe | Nifty 500 | `nifty500` |
| Filter | SETUP+ | `SETUP_PLUS` → label **SETUP+** |
| Scanned | 499 | `symbols_requested` (full universe) |
| Hits | 98 | `scan_summary.hits` |
| Strict ENTER | 40 | `scan_summary.strict_enter` |
| Discovery ENTER | 67 | `scan_summary.discovery_enter` |
| SETUP | 31 | `scan_summary.setup` |
| No chart | 16 | `scan_summary.no_chart` |
| Regime | Bear (NIFTYBEES) | `regime.label` + bear overlay note |
| Engine | v3.9-gc9 | `engine_version` |
| Duration | 26.74s | `duration_ms` |
| Prefetch | 1 cached · 498 fetched | **Not yet exposed in v2** |

### First hit — KIMS (sanity row)

| Field | PHP | v2 engine (same bar) |
|-------|-----|----------------------|
| Swing rank | 92 | `scoreHit()` composite |
| Tier | A | `tier(entry_score)` → A if score ≥ 75 |
| Entry score | 94 | `entry_score` |
| Discovery / Strict | ENTER / ENTER | dual verdict columns |
| Rules | 10/11 | `rules_passed` / `rules_scored` |
| Price | ₹817.15 EOD 2026-07-07 | `price` + `as_of_date` |
| Stop / Target / R | ₹794.68 / ₹892.65 / 3.36 | `computeTradePlan()` |
| RSI | 57.2 | `ta_rsi14` |
| 52w% | 86% · RED | `ta_pct_52w` + `ta_52w_chart_zone` |
| Vol× | 0.11× | `ta_volume_ratio` |
| Brk | — | `broke_swing_high` |
| MACD | 1.61 | `ta_macd_hist` |

**Note:** Absolute hit counts and prices drift with EOD date and universe CSV version. Compare **logic** on the same bar; compare **counts** only after `pnpm sync:indices` and matching cache state.

---

## Verified correct (PASS)

### Scanner engine

- **`matchesMinVerdict`:** Strict ENTER always passes; SETUP+ = discovery ENTER or SETUP; WATCH+ / ALL aligned with PHP.
- **52w zone filter:** Green / mid (25–75%) / red using `ta_52w_chart_zone` and `ta_pct_52w`.
- **GC9-only (E11):** Optional gate via `matchesGc9Entry`.
- **Breakout + volume:** Swing-high break + surge ≥ 1.08× 20d avg (`VOLUME_SURGE_MIN`).
- **Required rules / min rules passed:** `matchesEntryRules` / `entry-filters.ts`.
- **`filter_stats`:** Counts for min_verdict, zone, gc9, breakout, entry_rules, no_ta, no_price.
- **`buildScanSummary`:** strict_enter, discovery_enter, setup, filter_label, no_chart, full_universe.
- **Sort options:** swing_rank (default), rules_passed, r_multiple, **rsi low first**, **pct_52w low first**, volume_ratio high first, **symbol A–Z**.

### Rank & tier (CFA interpretation)

```text
swing_rank = f(entry_score × 0.65, verdict bonuses, r_multiple_ok, liquidity, stale, bear)
Tier letter (A/B/C/D) = tier(entry_score)  →  A ≥ 75, B ≥ 60, C ≥ 45
```

PHP workflow text *“Tier A ≥ 70”* refers to **swing_rank ≥ 70** as a quality filter for live orders, not the Tier column letter. v2 UI copy was corrected to avoid conflating the two.

### Scan API (`POST /api/v1/swing/scan`)

- `maxScan: 0` or omitted → entire universe (`resolveUniverseSymbols` + no slice).
- `background: true` (auto ≥ 25 symbols) → worker job with progress polling.
- Response includes: `hits`, `filter_stats`, `scan_summary`, `symbols_requested`, `duration_ms`, `regime`, `engine_version`.

### Universe UI (July 2026 pass)

| Feature | Status |
|---------|--------|
| Universe picker (DB + builtin + Tier-A + ETF presets) | PASS |
| Max stocks `0 = entire universe` | PASS |
| Min verdict labels (SETUP+, Strict ENTER, WATCH+, ALL) | PASS |
| 52w zone filter with descriptive labels | PASS |
| Sort (7 options, correct direction) | PASS |
| GC9 only / Breakout + volume | PASS |
| Require rules E1–E11 | PASS |
| Background scan checkbox (25+ symbols) | PASS |
| Refresh daily closes (`refresh: true`) | PASS |
| KPI bar: regime, engine, scanned, hits, filter, verdict counts | PASS |
| Filter breakdown (always when stats exist) | PASS |
| CFA workflow + bear overlay guidance | PASS |
| Hits table: 17 columns + expandable E1–E11 | PASS |
| Symbol link → `/swing?mode=symbol&symbol=X&autorun=1` | PASS |
| Inline + Add → `POST /api/v1/swing/positions` | PASS |

---

## Gaps requiring modification

### P1 — No universe golden fixture test (CFA audit trail)

**Symptom:** Cannot prove KIMS / top-hit numeric parity in CI.

**Required fix:** Add `packages/swing/src/parity-universe-kims.test.ts` (or similar) with frozen TA + bars from PHP dump:

- Rank 92, tier A, score 94, stop ₹794.68, target ₹892.65, R 3.36

**Owner:** `packages/swing/src/parity-universe-kims.test.ts`

---

### P1 — Universe scan fetches hourly bars for every symbol

**Symptom:** Nifty 500 scan pulls 1H data per symbol; PHP universe scan uses **daily only**. Adds latency vs PHP ~27s benchmark.

**Root cause:** `runSwingScan()` → `buildSymbolContext(..., { include_hourly: true })` by default.

**Required fix:**

```typescript
// packages/data-adapters/src/swing-scan.ts
const ctx = await buildSymbolContext(sym, refresh, { include_hourly: false });
```

Hourly remains available on single-symbol evaluate. Re-benchmark after change.

**Owner:** `packages/data-adapters/src/swing-scan.ts`

---

### P1 — Sequential symbol evaluation (no batch prefetch stats)

**Symptom:** PHP shows **Prefetch 1 cached · 498 fetched**; v2 has no equivalent transparency and processes symbols serially.

**Required fix:**

1. Track `cache_hits` / `cache_misses` in `fetchDailyBars` / `runSwingScan`.
2. Expose in scan result: `prefetch: { cached, fetched }`, `source: 'Yahoo daily'`.
3. Display in `SwingUniverseScanSummary` KPI pills.

**Owner:** `swing-chart.ts`, `swing-scan.ts`, `SwingUniverseScanSummary.tsx`

---

### P1 — Regime label missing index proxy suffix

**Symptom:** PHP shows **Bear (NIFTYBEES)**; v2 shows **Bear** only.

**Required fix:** Append `(NIFTYBEES)` when regime source is index ETF proxy — e.g. `regime.source` or hardcoded disclosure in summary component.

**Owner:** `SwingUniverseScanSummary.tsx` or `market-regime.ts`

---

### P2 — ETF category sub-filter

**Symptom:** PHP `swing_etf` universe has category picker (rotation, index, sector, …). v2 lists ETF universe but no category filter on scan form.

**Owner:** `SwingScanPage.tsx`, scan schema if new param needed.

---

### P2 — `patch_stock_price` option

**Symptom:** PHP optional checkbox to patch stock cache price after scan. Not ported.

**Low priority** — admin/ops feature; document as intentional omission unless parity required.

---

### P2 — URL state preservation

**Symptom:** PHP preserves scan params in symbol links and +Add return URLs. v2 symbol link passes `mode`, `symbol`, `autorun` only — not universe/filter state.

**Suggested fix:** Append `universe`, `min_verdict`, `sort_by`, `zone_52w` to query string on symbol links and after +Add navigation.

**Owner:** `SwingUniverseHitsTable.tsx`, `SwingScanPage.tsx`

---

### P2 — Build workflow: `@sv/shared` dist stale

**Symptom:** `maxScan: 0` returned `Number must be greater than or equal to 1` when `packages/shared/dist` was not rebuilt after schema change.

**Required process:**

```bash
pnpm --filter @sv/shared build   # or pnpm dev:all (runs predev:all)
```

**Suggested fix:** Add `predev` hook on `@sv/api` to depend on shared build, or document in GETTING-STARTED.

**Owner:** root `package.json`, `docs/GETTING-STARTED.md`

---

### P2 — `no_chart` double-count risk

**Symptom:** `no_chart = (symbols.length - contexts.length) + filter_stats.no_ta` may overlap if `no_ta` includes symbols already counted as missing context.

**Required fix:** Audit counters; prefer:

- `no_chart_fetch` = symbols failed `buildSymbolContext`
- `no_ta_in_scan` = contexts failing `ta_ready` inside loop

**Owner:** `packages/data-adapters/src/swing-scan.ts`

---

### P2 — Documentation drift

| Doc | Issue |
|-----|--------|
| `docs/API.md` | Scan response schema missing `scan_summary`, `symbols_requested`, `duration_ms` |
| `docs/SWING-IMPROVEMENTS.md` | Universe scan section not updated for July 2026 UI |
| `docs/TRADING-PRESETS.md` | Still notes `swing_tier_a` partial — universe API now merges preset |

---

## Component ↔ CFA concept map (universe mode)

| UI component | CFA concept |
|--------------|-------------|
| `SwingScanPage` (form) | Investment universe definition & filter specification |
| `SwingUniverseScanSummary` | Scan metadata disclosure — regime, filter, population counts |
| `SwingUniverseHitsTable` | Ranked opportunity set with dual verdicts (discovery vs strict) |
| Strict ENTER count | Order-ready subset (full E1–E8 + score floor) |
| Discovery ENTER count | Wider research funnel (SETUP+ filter) |
| SETUP count | Forming setups — watchlist candidates |
| Stop / Target / R columns | Per-name risk budget and reward asymmetry |
| 52w% + zone | Position in annual range — reversal vs momentum context |
| Vol× / Brk / MACD | Confirmation factors (liquidity event, structure, momentum) |
| `SwingScanHitAddButton` | Journal entry with frozen plan levels |
| Filter breakdown | False-negative transparency (why names dropped) |

---

## CFA workflow sign-off (universe scan)

| Use case | Approved? |
|----------|-----------|
| SETUP+ universe discovery / watchlist building | **Yes** |
| Sort by swing rank for prioritization | **Yes** |
| Strict ENTER column for live order shortlist | **Yes** (verify score floor + regime gate per name) |
| Stop placement from scan row | **Yes** (same engine as single-symbol) |
| Profit target / R for sizing | **Yes** (post P0 momentum fix — see symbol report) |
| Comparing exact hit count vs PHP (98/499) | **No** — requires same EOD + universe CSV + cache |
| Client-facing trade advice | **No** — research tool only |

---

## Modification checklist

| Priority | Item | Owner file(s) | Status |
|----------|------|---------------|--------|
| — | Scanner filters, sort, summary, hits table UI | `scanner.ts`, `SwingScanPage`, components | **Done** |
| — | `maxScan: 0` schema + API slice fix | `schemas.ts`, `swing.ts` | **Done** |
| — | `scan_summary` return type | `scanner.ts` | **Done** |
| P1 | KIMS / universe golden fixture test | `parity-universe-kims.test.ts` | **Done** |
| P1 | Disable hourly fetch on universe scan | `swing-scan.ts` | **Done** |
| P1 | Prefetch cached/fetched + Source KPI | `swing-chart.ts`, summary UI | **Done** |
| P1 | Regime label `(NIFTYBEES)` | `market-regime.ts`, summary UI | **Done** |
| P2 | ETF category sub-filter | `SwingScanPage` | Open |
| P2 | URL state on symbol links | `SwingUniverseHitsTable` | Open |
| P2 | Split `no_chart` counters | `swing-scan.ts` | Open |
| P2 | Update `docs/API.md` scan schema | `docs/API.md` | Open |
| P2 | Shared package rebuild in dev workflow | `package.json`, GETTING-STARTED | Open |

---

## Related documents

- [SWING-SYMBOL-CFA-VERIFICATION.md](./SWING-SYMBOL-CFA-VERIFICATION.md) — single-symbol / trade plan parity  
- [SWING-IMPROVEMENTS.md](./SWING-IMPROVEMENTS.md) — improvement backlog  
- [API.md](./API.md) — HTTP contracts  
- [TRADING-PRESETS.md](./TRADING-PRESETS.md) — conservative Tier-A preset URLs  
- PHP golden: `docs/txt/swing-trading.phpscan_job_id=e052d595a19c0b28&mode=universe&universe=nifty500.txt`

---

*Re-run this report after P1 performance fixes, golden fixture addition, or `ENGINE_VERSION` bump.*
