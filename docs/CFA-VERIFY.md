# CFA Verify — Architecture & Speed Plan

**CFA Verify** is the one-click institutional valuation memo: auto-fetch fundamentals, run CFA valuation (DCF, fair P/E, sector models), score quality, compute margin of safety, and render an investment memo — with optional **Full Verify** (8 manual phases) before allocating capital.

In **Script Screener v2**, `/verify` runs the **valuation engine only** (`CfaValuationEngine` via `estimate()`). The PHP **8-phase `VerificationEngine`**, investment memo UI, annual-report inference, and verify result cache are **not yet ported**.

> Educational research only — screening-mode auto-verify assumes Phase 0 gates; confirm personally before investing.

---

## Table of contents

1. [What it does](#what-it-does)
2. [PHP vs Script Screener](#php-vs-script-screener)
3. [Two verify modes (PHP)](#two-verify-modes-php)
4. [Why the new architecture can be faster](#why-the-new-architecture-can-be-faster)
5. [System architecture](#system-architecture)
6. [Data flow](#data-flow)
7. [Valuation engine](#valuation-engine)
8. [8-phase engine (PHP only)](#8-phase-engine-php-only)
9. [Investment memo (PHP)](#investment-memo-php)
10. [Verify cache](#verify-cache)
11. [History & watchlist sync](#history--watchlist-sync)
12. [Batch verify (PHP)](#batch-verify-php)
13. [API mapping (PHP → v2)](#api-mapping-php--v2)
14. [UI surfaces](#ui-surfaces)
15. [Parity matrix](#parity-matrix)
16. [Speed optimization plan](#speed-optimization-plan)
17. [Implementation phases](#implementation-phases)
18. [File reference](#file-reference)

---

## What it does

| Capability | Description |
|------------|-------------|
| **One-click verify** | Enter NSE symbol → auto-fetch → CFA valuation memo |
| **Sector models** | DCF + fair P/E + DDM (FMCG/IT), P/B (banking), EV/EBITDA (metal/cement), etc. |
| **Quality score** | 0–100 composite from ROE, ROCE, margins, Piotroski, moat heuristics |
| **Verify score** | 0–56 gate scorecard (PHP `VerificationEngine` only) |
| **MOS & verdict** | Intrinsic value, MOS %, zone, recommendation matrix |
| **Graham / Altman** | Graham number credibility, Altman Z zone, data-quality gates |
| **Annual report scan** | Inferred AR gates from Screener profile (PHP auto-verify) |
| **Investment memo** | Grade A–F, conviction, strengths/risks, position sizing (PHP) |
| **Full Verify** | Manual 8-phase form with attestation (PHP `index.php`) | See [FULL-VERIFY.md](FULL-VERIFY.md) |
| **Verify cache** | 7-day cached result with live price refresh (PHP) |
| **History** | Per-user verification runs (v2 PostgreSQL) |
| **Watchlist sync** | Last MOS/score/verdict on watched symbols after verify |

---

## PHP vs Script Screener

| Aspect | PHP (`stock-verifier`) | Script Screener (`stock-verifier-v2`) |
|--------|------------------------|--------------------------------------|
| **One-click page** | `verify.php` | `/verify` (`VerifyPage.tsx`) |
| **Full verify page** | `index.php` — 8 phases, manual form | **Not implemented** |
| **API** | Server-rendered HTML (GET form) | `POST /api/v1/verify/auto` |
| **Orchestrator** | `CfaAutoVerifier::analyze()` | `verifyStock()` → `estimate()` |
| **Valuation** | `CfaValuationEngine` inside `VerificationEngine` | `CfaValuationEngine.analyze()` direct |
| **8-phase gates** | `VerificationEngine` (Phases 0–8) | **Not ported** |
| **Investment memo** | `CfaInvestmentMemo::build()` + `cfa_report.php` | **Table only** (8 fields) |
| **Annual report** | `AnnualReportLogic::inferGates()` | **Not ported** |
| **Auto-fill** | ~80 fields via `buildVerifierAutoFill()` | ~15 metrics from `fetchStockData` |
| **Verify cache** | `VerificationResultCache` 7d + price refresh | `sv:verify` key **defined, not wired** |
| **UI refresh** | Cache by default; stale if price drift >1% | UI sends `refresh: true` every click |
| **History** | Optional JSON file | `verification_runs` table + API |
| **Batch job** | `AnnualVerifyJob` + `run-annual-verify-job.php` | **Planned** Phase 13 |
| **Parity tests** | `validate-logic.php`, `test-cross-page.php` | 13 golden tests in `@sv/core` (valuation only) |
| **Cross-links** | Details, Screener, Full Verify | **No** Details / Full Verify links |

---

## Two verify modes (PHP)

### 1. Screening auto-verify (`verify.php`)

```
symbol
  → CfaAutoVerifier::analyze()
       → StockDataFetcher::fetch()
       → buildVerifierAutoFill() + AnnualReportLogic + applyCfaDefaults()
       → VerificationEngine::run()   // screening_mode = true
       → CfaInvestmentMemo::build()
       → VerificationResultCache::put()
  → renderCfaReport()
```

**Screening defaults** (disclosed in assumptions):

- Phase 0: emergency fund, debt cleared, discipline — assumed satisfied
- Phase 1: business model, circle of competence — inferred yes
- Phase 4–7: growth, peer compare, portfolio fit — heuristic defaults
- Position size: 3–5% based on ROE

Banner warns: *"Screening mode — use Full Verify before allocating capital."*

### 2. Full verify (`index.php`)

```
symbol → fetch → manual form (80+ fields across 8 phases)
  → VerificationEngine::run()
  → investmentReady() with manual_attestation
  → executive summary, data quality panel, phase scorecard
```

User attests each gate. Required before `investment_ready` badge (non-screening).

### v2 today

Only the **valuation slice** of screening auto-verify:

```
POST /api/v1/verify/auto
  → verifyStock(symbol, refresh=true)
       → fetchStockData → estimate() → matrixVerdict()
  → prisma.verification_runs.create()
  → syncWatchlistFromVerify()
```

No phases, no memo, no annual report, no cache read.

---

## Why the new architecture can be faster

### 1. Redis verify cache (planned — Phase 9)

PHP `VerificationResultCache`:

| Key | TTL | Content |
|-----|-----|---------|
| `stock_verify/verify:{SYM}` | 7d | Full analyze payload |

v2 constant: `sv:verify:{SYM}` — **not wired**.

Warm verify target: **p95 < 50ms** (read cache + optional price patch).

### 2. Stop forcing refresh on every click

`VerifyPage.tsx` sends `refresh: true` always → bypasses `sv:stock` and `sv:verify`.

**Fix:** default `refresh: false`; explicit "Refresh live data" button.

### 3. Price-only refresh (PHP pattern)

When verify cache hit but `sv:stock` price drifted >1%:

- Recompute P/E from live price
- Update MOS from cached intrinsic
- Skip full Yahoo + Screener refetch

v2 should port `cachedPriceStale()` + `refreshCachedLivePrice()` logic.

### 4. Shared fetch cache with screener

After screener scan of TCS, verify TCS should hit `sv:stock:TCS` (7d) — only run `estimate()` locally (~5ms).

### 5. JSON API vs SSR

PHP renders full HTML memo server-side. v2 can:

```
GET /verify/auto?symbol=TCS     → summary JSON (cached)
GET /verify/memo/:id            → full memo from history (no refetch)
```

Client renders progressively; first paint < 200ms cached.

### Latency budget

| Action | Target (warm) | Target (cold) |
|--------|---------------|---------------|
| Verify API (cached) | p95 < **50ms** | — |
| Verify API (stock cache hit) | p95 < **150ms** | — |
| Verify API (cold fetch) | — | p95 < **2.5s** |
| Full memo render (client) | < **100ms** | — |

---

## System architecture

### v2 today

```
┌─────────────┐  POST /api/v1/verify/auto   ┌─────────────┐
│ VerifyPage  │ ◄──────────────────────────►│   Fastify   │
│  /verify    │  GET  /verify/history       └──────┬──────┘
└─────────────┘                                     │
                                                    ▼
                                         ┌──────────────────┐
                                         │ verify.ts        │
                                         │ verifySymbol()   │
                                         └────────┬─────────┘
                                                  │
                    ┌─────────────────────────────┼─────────────────┐
                    ▼                             ▼                 ▼
             verifyStock()              verification_runs    watchlist sync
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
  fetchStockData          estimate()
  (yahoo+screener)    CfaValuationEngine
         │                     │
         └──────────┬──────────┘
                    ▼
              Redis sv:stock:*
              (sv:verify — not wired)
```

### v2 planned (full parity)

```
POST /api/v1/verify/auto
  → CfaAutoVerifier port (orchestrator)
       → fetchStockData (parallel Yahoo + Screener)
       → AnnualReportLogic (profile scrape)
       → VerificationEngine port (8 phases)
       → CfaInvestmentMemo port
       → sv:verify cache put
  → verification_runs (compact + full JSON)
```

---

## Data flow

### PHP `CfaAutoVerifier::runFromFetch()`

| Step | Component | Output |
|------|-----------|--------|
| 1 | `StockDataFetcher::fetch()` | 30+ fundamental fields |
| 2 | `buildVerifierAutoFill()` | Verifier input (~50 keys) |
| 3 | `ScreenerCompanyProfile::fetch()` | Business text for AR gates |
| 4 | `AnnualReportLogic::inferGates()` | 4-point AR scan |
| 5 | `applyCfaDefaults()` | Phase 0–7 screening defaults |
| 6 | `VerificationEngine::run()` | Phases, scorecard, verdict, metrics |
| 7 | `CfaInvestmentMemo::build()` | Grade, memo sections, valuation block |

### v2 `verifyStock()`

| Step | Component | Output |
|------|-----------|--------|
| 1 | `fetchStockData()` | ~15 core metrics |
| 2 | `applyPromoterHolding()` | PostgreSQL overlay |
| 3 | `estimate()` | intrinsic, MOS, fair P/E, quality, method |
| 4 | `matrixVerdict()` | recommendation string |

---

## Valuation engine

Both PHP and v2 use the same **`CfaValuationEngine`** logic (v2 ported with golden tests).

### Sector models

| Sector key | Model | Alt value |
|------------|-------|-----------|
| fmcg, it, pharma, auto, defence | `dcf_fairpe_ddm` | DDM intrinsic |
| banking, nbfc, insurance | `pb` | Book-based |
| metal, cement, telecom, infra, oil_gas | `ev_ebitda` | EBITDA-based |
| utility, reit | `ddm_dcf` | Dividend DCF |

### Fair P/E formula

```
clamp(8 + 0.4×EPS_CAGR(5Y) + 0.1×ROCE + Moat + Size − Debt, 8, 40)
```

Intrinsic blends DCF + fair P/E (+ DDM if dividend yield ≥ 0.5%).

### v2 parity coverage (`parity.test.ts`)

- MOS formula
- Sector routing (banking P/B, ONGC Graham floor)
- TCS-like estimate vs PHP `MosHelper::estimate`
- Altman zone, moat tier, fair P/E

**Not tested in v2:** full `VerificationEngine` scorecard, phase gates, investment-ready badge.

### Verify score mapping (v2)

```typescript
composite = quality_score ?? 0          // 0–100
verify_score = round(composite * 56 / 100)   // 0–56
recommendation = matrixVerdict(verify_score, mos)
```

PHP uses `scorecard.total` from 8 phases (max 56) — different input path, same matrix.

---

## 8-phase engine (PHP only)

`VerificationEngine` evaluates Ch.99 guide phases:

| Phase | Focus | Auto-verify default |
|-------|-------|---------------------|
| 0 | Investor readiness (emergency fund, debt, discipline) | Assumed pass |
| 1 | Business understanding | Inferred from summary/mcap |
| 2 | Management & governance | Screening defaults |
| 3 | Financial health (debt, FCF, margins) | From fetch metrics |
| 4 | Growth & moat | Revenue growth heuristics |
| 5 | Valuation (MOS, fair P/E) | `CfaValuationEngine` |
| 6 | Peer & macro context | Assumed yes |
| 7 | Portfolio fit & position size | 3–5% default |
| 8 | Final attestation | Auto in screening mode |

Outputs: `scorecard` (0–56), `red_flag_scan`, `investment_ready`, `position_size`, `executive_summary`.

**v2 gap:** Entire engine unported. Valuation outputs come from `estimate()` only.

---

## Investment memo (PHP)

`CfaInvestmentMemo::build()` + `renderCfaReport()` sections:

| Section | Content |
|---------|---------|
| Screening warning | Link to Full Verify |
| Annual report scan | 4 inferred checks |
| Hero | Grade A–F, verdict, conviction, quality ring |
| Assumptions | Collapsible auto-assumption list |
| Valuation summary | 10-point ordered list (DCF, MOS, risks) |
| Investment case | Narrative paragraph |
| Metric row | Price, intrinsic, MOS, fair P/E, DCF, P/E, model |
| Fair P/E rationale | Senior CFA formula explanation |
| Quality row | ROE, ROCE, D/E, F-Score, Graham, Z-Score, moat |
| Data quality panel | Cache freshness, Graham credibility |
| Investment ready badge | Pass/fail with reasons |
| Position sizing | % allocation suggestion |
| Pillars | Quality pillar ratings |
| Strengths / risks / next steps | Bullet lists |
| Phase scorecard | Per-phase pass rates |
| Footer links | Details, Screener, Watchlist |

### v2 `VerifyPage` today

Single table: intrinsic, MOS, fair P/E, Graham, quality score, method, verdict.

**~15% of PHP memo UI.**

---

## Verify cache

### PHP `VerificationResultCache`

```
SOURCE: stock_verify
KEY:    verify:{SYM}
TTL:    7 days (DataCache::TTL_SECONDS)
```

**Read path:**

1. `get(symbol)` → full analyze payload
2. If price stale (>1% vs `sv:stock` fetch cache) → invalidate
3. Else `refreshCachedLivePrice()` — patch price/P/E only

**Write path:** After successful `CfaAutoVerifier::analyze()`.

**Compact summary:** `summary(symbol)` for screener row hints.

### v2

| Key | TTL | Status |
|-----|-----|--------|
| `sv:verify:{SYM}` | 7d | Constant defined in `@sv/shared` — **not read/written** |
| `sv:stock:{SYM}` | 7d | Used by fetch; verify ignores when `refresh=true` |

**Phase 9 deliverable:** wire cache in `verifyStock()` / `verify.ts`.

---

## History & watchlist sync

### v2 (implemented)

**`verification_runs`** (PostgreSQL):

| Column | Purpose |
|--------|---------|
| `userId` | Owner |
| `symbol` | NSE symbol |
| `mode` | `auto` |
| `result` | Full JSON blob |
| `createdAt` | Timestamp |

**API:**

- `GET /api/v1/verify/history?limit=20&symbol=TCS`
- `GET /api/v1/verify/history/:id`

**Watchlist sync** (`syncWatchlistFromVerify`):

Updates watched symbol meta: `last_score`, `last_mos`, `last_verdict`, `stock_name`, `sector`.

### PHP

Optional `data/verify_history.json` — migrated via `pnpm migrate:php`.

No per-user history (single-tenant file).

---

## Batch verify (PHP)

| Component | Role |
|-----------|------|
| `AnnualVerifyJob` | Job CRUD in `stock_verify_job` cache |
| `AnnualVerifyBatch` | Iterates universe, runs `CfaAutoVerifier` |
| `run-annual-verify-job.php` | Background worker spawn |

Options: `universe`, `max`, `skip_fresh`, `force_refresh`.

**v2:** Planned Phase 13 — `verify_batch` BullMQ job type.

---

## API mapping (PHP → v2)

| PHP | v2 |
|-----|-----|
| GET `verify.php?symbol=TCS` | `POST /api/v1/verify/auto` `{ "symbol": "TCS" }` |
| POST `index.php` (manual verify) | **Not planned in v2 MVP** — consider `/verify/full` |
| Cache read (implicit) | `GET /api/v1/verify/auto?symbol=TCS` (planned) |
| Admin refresh caches | `POST /api/v1/stock/:symbol/refresh` (Stock Details SD-D) |
| `AnnualVerifyJob` status | `GET /api/v1/verify/jobs/:id` (planned) |

### Response shape (v2 today)

```json
{
  "symbol": "TCS",
  "success": true,
  "metrics": { "symbol": "TCS", "price": 3850, "pe": 28, "roe": 52, "..." },
  "analysis": {
    "intrinsic": 4200,
    "mos": 8.3,
    "zone": "Fair",
    "fair_pe": 32,
    "quality_score": 78,
    "verify_score": 44,
    "recommendation": "Buy",
    "final_rating": "Buy",
    "graham": 890,
    "method": "DCF + Fair P/E + DDM"
  },
  "sources": ["yahoo", "screener.in"],
  "from_cache": false,
  "educational_only": true,
  "disclaimer": "Research tool only — not SEBI-registered investment advice."
}
```

### Planned full memo response

```json
{
  "symbol": "TCS",
  "screening_mode": true,
  "memo": {
    "grade": "A",
    "verdict": "Strong Buy",
    "conviction": "High",
    "valuation": { "intrinsic": 4200, "mos_pct": 8.3, "..." },
    "quality": { "score": 78, "roe": 52, "..." }
  },
  "phases": [ { "id": 0, "title": "...", "passed": true } ],
  "annual_report": { "score": 3, "status": "warn", "checks": {} },
  "assumptions": ["Phase 0 assumed satisfied..."],
  "investment_ready": { "ready": false, "reasons": ["screening_mode"] }
}
```

---

## UI surfaces

### PHP `verify.php`

- Symbol search + quick links (TCS, RELIANCE, HDFCBANK, …)
- Link to Stock Details, Screener
- Full `renderCfaReport()` memo

### v2 `/verify`

- Symbol input + "Auto verify" button
- Compact results table
- Recent verifications sidebar (10 rows)
- **Missing:** grade hero, assumptions, annual report, phase scorecard, quick symbols, cross-links

### Planned enhancements

| UI element | Phase |
|------------|-------|
| Memo hero (grade, conviction) | V-B |
| Assumptions collapsible | V-B |
| Quick symbol chips | V-A |
| Link to `/stock/:symbol` | V-A (with Stock Details) |
| "Refresh live" vs cached badge | V-A |
| Full Verify route `/verify/full` | V-C |
| Batch verify admin panel | V-D |

---

## Parity matrix

| Feature | PHP | v2 | Gap |
|---------|-----|-----|-----|
| One-click verify page | ✓ | partial | **V-A** |
| `CfaValuationEngine` / MOS | ✓ | ✓ | Golden tests pass |
| 8-phase `VerificationEngine` | ✓ | ✗ | **V-C** |
| Investment memo UI | ✓ | ✗ | **V-B** |
| Grade A–F hero | ✓ | ✗ | **V-B** |
| Annual report inference | ✓ | ✗ | **V-B** |
| Screening assumptions banner | ✓ | ✗ | **V-B** |
| Data quality panel | ✓ | ✗ | **V-B** |
| Investment ready badge | ✓ | ✗ | **V-C** |
| Position sizing | ✓ | ✗ | **V-C** |
| Verify cache 7d | ✓ | ✗ | **V-A** (Phase 9) |
| Price-only cache refresh | ✓ | ✗ | **V-A** |
| Default refresh=false | ✓ | ✗ | **V-A** |
| Per-user history | file | PostgreSQL | v2 **better** |
| Full Verify (`index.php`) | ✓ | ✗ | **V-C** |
| Batch annual verify job | ✓ | ✗ | **V-D** |
| Cross-page IV parity | ✓ | partial | **V-D** |
| REST JSON API | ✗ | ✓ | v2 improvement |

---

## Speed optimization plan

### Phase V-A — Cache & UX (1–2 days, overlaps M9)

| # | Task |
|---|------|
| V-A1 | Wire `sv:verify` read/write in `verifyStock()` |
| V-A2 | Default `refresh: false` on VerifyPage; add "Refresh live" toggle |
| V-A3 | Port price staleness check (>1% drift invalidates verify cache) |
| V-A4 | Quick symbol chips (TCS, RELIANCE, …) |
| V-A5 | Show `from_cache` badge + sources in UI |
| V-A6 | Link to Stock Details / Screener from result card |

### Phase V-B — Memo UI (3–4 days)

| # | Task |
|---|------|
| V-B1 | Port `CfaInvestmentMemo` → `@sv/core/investment-memo.ts` |
| V-B2 | Port `AnnualReportLogic` → `@sv/data-adapters/annual-report.ts` |
| V-B3 | `VerifyMemo.tsx` — hero, valuation summary, metric rows |
| V-B4 | Assumptions panel + screening mode warning |
| V-B5 | Annual report scan section |
| V-B6 | Data quality + valuation flags banners |

### Phase V-C — 8-phase engine (5–7 days)

| # | Task |
|---|------|
| V-C1 | Port `VerificationEngine` → `@sv/core/verification-engine.ts` |
| V-C2 | Port `buildVerifierAutoFill()` from PHP fetcher |
| V-C3 | `CfaAutoVerifier` orchestrator in `@sv/data-adapters` |
| V-C4 | Phase scorecard UI component |
| V-C5 | `investmentReady()` + badge |
| V-C6 | Optional `/verify/full` — manual phase form (React) |

### Phase V-D — Batch & parity (2–3 days)

| # | Task |
|---|------|
| V-D1 | `POST /api/v1/verify/batch` + BullMQ `sv-verify-batch` |
| V-D2 | Admin UI for batch job progress |
| V-D3 | Expand parity suite: `test-cross-page.php` fixtures in vitest |
| V-D4 | IV drift warning (screener MOS vs verify IV) |

### Acceptance criteria

- [ ] Repeat verify TCS within 7d → `from_cache: true`, p95 < **50ms**
- [ ] Cold verify p95 < **2.5s**
- [ ] TCS/RELIANCE IV within **1%** of PHP `test-cross-page.php`
- [ ] Memo grade + MOS match PHP `verify.php` for golden fixtures
- [ ] Screening banner shown; assumptions list visible
- [ ] Watchlist meta updates after verify (already works)

---

## Implementation phases

```
Now — valuation-only /verify
  │
  ├─► V-A: sv:verify cache + refresh UX (Phase 9)
  │
  ├─► V-B: Investment memo + annual report UI
  │
  ├─► V-C: VerificationEngine + Full Verify
  │
  └─► V-D: Batch job + cross-page parity tests
```

**Dependency note:** V-B can ship before V-C by building memo from `estimate()` output (valuation-only memo). Full parity requires V-C.

---

## File reference

### Script Screener (v2) — existing

```
packages/core/src/cfa-valuation-engine.ts    Sector models, DCF, fair P/E
packages/core/src/mos-helper.ts              estimate() wrapper
packages/core/src/valuation.ts               matrixVerdict, fair P/E helpers
packages/core/src/parity.test.ts             Golden tests vs PHP
packages/data-adapters/src/screener-run.ts   verifyStock()
packages/data-adapters/src/stock-data-fetcher.ts
apps/api/src/services/verify.ts               verifySymbol(), history
apps/api/src/server.ts                        /api/v1/verify/*
apps/web/src/pages/VerifyPage.tsx
packages/shared/src/constants.ts              sv:verify TTL
```

### Script Screener (v2) — planned

```
packages/core/src/verification-engine.ts
packages/core/src/investment-memo.ts
packages/data-adapters/src/cfa-auto-verifier.ts
packages/data-adapters/src/annual-report.ts
apps/web/src/components/VerifyMemo.tsx
apps/web/src/pages/VerifyFullPage.tsx
```

### PHP reference (stock-verifier)

```
verify.php
index.php                                   Full Verify (8 phases)
includes/CfaAutoVerifier.php
includes/VerificationEngine.php             ~1400 lines, 8 phases
includes/CfaInvestmentMemo.php
includes/CfaValuationEngine.php
includes/AnnualReportLogic.php
includes/VerificationResultCache.php
includes/cfa_report.php                     renderCfaReport()
includes/AnnualVerifyJob.php
includes/AnnualVerifyBatch.php
run-annual-verify-job.php
validate-logic.php                          Engine golden tests
test-cross-page.php                         IV/MOS cross-page parity
verify-swing-cfa.php                        CLI swing+CFA backtest (separate)
```

---

## Related docs

- [Full Verify](FULL-VERIFY.md) — 8-phase allocation gate (`index.php`); engine port shared with V-C / FV-C
- [CFA Screener](SCREENER.md) — universe scan uses same `estimate()` path
- [Stock Details](STOCK-DETAILS.md) — full symbol hub; shares verify engine
- [API Reference](API.md) — verify endpoints
- [Redis & Cache](REDIS-CACHE.md) — `sv:verify`, `sv:stock` keys
- [Web UI](WEB-UI.md) — `/verify` page
- [Roadmap Phase 9](ROADMAP.md) — verify cache wiring
- [Development Milestones](MILESTONES.md) — M3 valuation parity, M9 cache
