# Full Verify — Architecture & Speed Plan

**Full Verify** is the allocation gate: an 8-phase analyst checklist (Ch.99 guide) with auto-fetch (~80 fields), manual attestation on personal-finance and portfolio gates, a 0–56 master scorecard, investment-ready badge, and watchlist thesis persistence.

In **Script Screener v2 this does not exist.** `/verify` is one-click valuation only. The PHP page `index.php` (~950 lines) plus `VerificationEngine` (~1,400 lines) are **not ported**.

> Educational research only — `investment_ready` requires manual attestation; screening auto-verify is not a substitute.

**Related:** [CFA Verify](CFA-VERIFY.md) (one-click screening) · [Stock Details](STOCK-DETAILS.md) (symbol hub)

---

## Table of contents

1. [What it does](#what-it-does)
2. [PHP vs Script Screener](#php-vs-script-screener)
3. [Analyst workflow](#analyst-workflow)
4. [Why the new architecture can be faster](#why-the-new-architecture-can-be-faster)
5. [System architecture (planned)](#system-architecture-planned)
6. [Form model](#form-model)
7. [Eight phases](#eight-phases)
8. [Auto-fill pipeline](#auto-fill-pipeline)
9. [Verification engine](#verification-engine)
10. [Investment-ready gate](#investment-ready-gate)
11. [Results panel](#results-panel)
12. [Watchlist integration](#watchlist-integration)
13. [Cache & draft state](#cache--draft-state)
14. [API mapping (PHP → v2)](#api-mapping-php--v2)
15. [UI surfaces](#ui-surfaces)
16. [Parity matrix](#parity-matrix)
17. [Speed optimization plan](#speed-optimization-plan)
18. [Implementation phases](#implementation-phases)
19. [File reference](#file-reference)

---

## What it does

| Capability | Description |
|------------|-------------|
| **8-phase wizard** | Tabbed form: Investor → Business → Financials → Ratios → Valuation → Quant → Sector → Portfolio → Thesis |
| **Fetch & Fill** | `StockDataFetcher` → `buildVerifierAutoFill()` — ~80 fields tagged AUTO |
| **Manual gates** | Phase 0, circle of competence, portfolio fit, exit triggers, thesis — user attested |
| **Sector panels** | Phase 6 adapts to 13 sector keys (banking, IT, metal, REIT, …) |
| **Master scorecard** | 0–56 points across phases; critical fails block verdict |
| **Red flag scan** | 10-point quick-reject scan (2+ flags = reject) |
| **CFA valuation** | `CfaValuationEngine` inside engine — DCF, fair P/E, MOS, quality score |
| **Data quality** | D1–D6 gates, Graham credibility, Altman Z source |
| **Investment ready** | Badge when score ≥35, MOS ≥15%, manual phases complete, attestation |
| **Position sizing** | Suggested % based on conviction and MOS |
| **Executive summary** | Strengths, risks, next steps, conviction tier |
| **Watchlist save** | Phase 8 thesis + review date → auto-save on verify |
| **CFA Auto Run** | Minimal-input path on same page (links to `verify.php`) |
| **Prefill URL** | `index.php?symbol=TCS&mode=auto` from screener, details, watchlist |

---

## PHP vs Script Screener

| Aspect | PHP (`stock-verifier`) | Script Screener (`stock-verifier-v2`) |
|--------|------------------------|--------------------------------------|
| **Page** | `index.php` (nav: "Full Verify") | **No route** |
| **Planned route** | — | `/verify/full` |
| **Form fields** | ~80+ across 9 phase panels | **0** |
| **Engine** | `VerificationEngine` (8 phases) | `estimate()` only (valuation slice) |
| **Form state** | `FormState` — merge auto + manual | **Not ported** |
| **Auto-fill** | `buildVerifierAutoFill()` | `fetchStockData` (~15 fields) |
| **Sector UI** | 13 `sector-panel` blocks in Phase 6 | **None** |
| **Scorecard** | 0–56 master table | `verify_score` derived from quality only |
| **Investment ready** | `investmentReady()` badge | **None** |
| **Attestation** | Phase 8 checkbox | **None** |
| **Thesis save** | Watchlist on verify + `review_date` | Watchlist CRUD; no thesis-from-verify flow |
| **Results layout** | Sticky sidebar: verdict, scorecard, gates | VerifyPage table (8 rows) |
| **i18n** | Hindi partial (`?lang=hi`) | English only |
| **CSRF** | `PageAuth::formPost()` | JWT API (no form CSRF) |

---

## Analyst workflow

PHP intended flow (from `AppGuide.php` and `USER-GUIDE.md`):

```
Screener / LTG Auto / Swing
        │
        ▼
  CFA Verify (screening)     ← quick memo, assumptions defaulted
        │
        ▼
  Full Verify (allocation)   ← all 8 phases, manual attestation
        │
        ├──► Investment ready badge
        ├──► Watchlist + thesis + review date
        └──► Stock Details / positions sizing
```

**Rule:** Screening passes are shortcuts. Allocation requires Full Verify + annual-report checks + Phase 0 personal foundation.

### Inbound links (PHP)

| Source | URL |
|--------|-----|
| Nav | `index.php` |
| CFA Verify memo | `index.php?symbol={SYM}&mode=auto` |
| Stock Details | `index.php?symbol={SYM}&mode=auto` |
| Watchlist | per-symbol Full Verify link |
| Screener IV drift | prompts re-run Full Verify |

---

## Why the new architecture can be faster

### 1. Split fetch from verify submit

PHP: single POST re-runs full page; fetch and verify share one form round-trip.

v2 planned:

```
POST /api/v1/verify/full/fetch   → { input, auto_keys, sources }  (cacheable)
POST /api/v1/verify/full/run     → { result, investment_ready }   (pure compute)
```

Fetch can hit `sv:stock` without re-rendering 900 lines of HTML.

### 2. Client-side phase navigation

PHP: all 9 phase panels in one DOM; JS tab switching only.

v2: React lazy-mount phase components → faster first paint; only active phase in DOM.

### 3. Draft persistence (new capability)

PHP loses unsaved form on refresh.

v2 planned: `localStorage` or `verify_drafts` table — resume mid-wizard without refetch.

### 4. Engine compute is cheap

`VerificationEngine::run()` is CPU-only (~50–200ms). Bottleneck is **fetch** (2–4s cold). Re-verify after editing Phase 7 should not refetch if `sv:stock` warm.

### 5. Shared cache with CFA Verify

Same symbol verified on `/verify` then opened on `/verify/full` → fetch step skipped; only manual gates remain.

### Latency budget (planned)

| Action | Target |
|--------|--------|
| Fetch & fill (warm `sv:stock`) | p95 < **200ms** |
| Fetch & fill (cold) | p95 < **2.5s** |
| Run verification (engine only) | p95 < **300ms** |
| Full page interactive (cached fetch) | < **500ms** |

---

## System architecture (planned)

```
┌──────────────────┐   POST .../full/fetch     ┌─────────────┐
│ VerifyFullPage   │ ◄────────────────────────►│   Fastify   │
│  /verify/full    │   POST .../full/run       └──────┬──────┘
│  (9 phase tabs)  │   GET  .../full/draft/:sym              │
└──────────────────┘                                    ▼
                                              ┌─────────────────────┐
                                              │ verify-full.ts      │
                                              └──────────┬──────────┘
                                                         │
              ┌──────────────────────────────────────────┼──────────────┐
              ▼                    ▼                     ▼              ▼
       fetchStockData      buildVerifierAutoFill   VerificationEngine  watchlist
       + pledge overlay    + watchlist merge       .run()              thesis save
              │                    │                     │
              └────────────────────┴─────────────────────┘
                                   Redis sv:stock:*
```

---

## Form model

### PHP `FormState`

```php
mergeAuto($auto, $manual, $autoKeyList)
  → manual values override auto when non-empty
  → auto_keys tracked for AUTO badge in UI

loadManual($manual)  // pure manual mode
all()                // input to VerificationEngine
```

**Design rule:** Manual always wins over auto-fill.

### v2 planned types

```typescript
type VerifyFullInput = Record<string, string | number | boolean>;
type VerifyFullDraft = {
  symbol: string;
  input: VerifyFullInput;
  autoKeys: string[];
  updatedAt: string;
};
```

### Actions (PHP `index.php`)

| `action` | Behavior |
|----------|----------|
| `fetch` | Fetch symbol → merge auto-fill → show form |
| `auto_verify` | `CfaAutoVerifier::analyze()` → populate form + show screening result |
| `verify` | `VerificationEngine::run()` → results panel + optional watchlist save |

---

## Eight phases

| Phase | Title | Auto-fill | Manual-only gates |
|-------|-------|-----------|-------------------|
| **0** | Investor Foundation | Stock identity, price, mcap | Emergency fund, debt, SIP, allocation, discipline |
| **1** | Business Quality | Industry outlook, pledge %, some governance | Circle of competence (1.1–1.4), moat ticks, auditor |
| **2** | Financial Statements | Revenue history, PAT, EPS, CFO, capex | AR scan checkboxes, PAT quality gates |
| **3** | Fundamental Ratios | ROE, ROCE, D/E, P/E, growth | ROE sustainability gates (3.1–3.3) |
| **4** | Value vs Growth | Intrinsic DCF/fair P/E, value-trap flags | Mr. Market text, growth stock block |
| **5** | Quant Screens | Piotroski estimate, Altman Z, DCF IV | Altman components, skip toggle |
| **6** | Sector-Specific | Sector metrics from fetch where available | KPI / peer / macro gates per sector |
| **7** | Portfolio Fit | — | Allocation %, position size, correlation, exit triggers |
| **8** | Thesis & Verdict | Review date default +1y | Thesis textareas, invalidations, **manual_attestation** |

### Phase 6 sector panels

Shown based on Phase 0 `sector` select:

`banking` · `it` · `defence` · `infra` · `fmcg` · `pharma` · `auto` · `metal` · `cement` · `telecom` · `utility` · `reit` · `general`

Each panel has sector KPI fields + yes/no gates (`p6_kpi_identified`, `p6_peer_compared`, `p6_macro_noted`).

### Phase 7 exit triggers (if holding)

`exit_thesis_broken` · `exit_pledge_fraud` · `exit_fundamentals_bad` · `exit_overvalued_25` · `exit_down_25_redflags`

Plus manual red-flag scan checkboxes (`rf_cannot_explain`, `rf_tip_buy`, …).

### Phase 8 thesis (watchlist gate)

Required for watchlist auto-save:

- `thesis_business` (required)
- `thesis_financials`, `thesis_valuation`
- `invalidation_1`, `invalidation_2`
- `review_date`
- `manual_attestation` (when `auto_prefilled`)

---

## Auto-fill pipeline

### PHP `StockDataFetcher::buildVerifierAutoFill()`

Maps fetch blob → verifier input:

| Category | Examples |
|----------|----------|
| Identity | `stock_name`, `sector`, `current_price`, `market_cap_cr` |
| Phase 2 P&L | `revenue_y1`…`revenue_latest`, `pat_latest`, `eps`, margins |
| Phase 2 BS/CF | `total_debt`, `shareholders_equity`, `cfo`, `capex`, `fcf` |
| Phase 3 ratios | `roe`, `roce`, `debt_to_equity`, `pe_ratio`, `dividend_yield` |
| Phase 4 valuation | `intrinsic_dcf`, `intrinsic_fair_pe`, value-trap flags (inferred) |
| Phase 5 quant | `piotroski_score`, `altman_z`, `altman_skip`, Altman components |
| Phase 1/6 | `p1_industry_outlook`, `p1_promoter_pledge`, sector-specific fields |

Also computes: Piotroski estimate, Altman Z (or skip for banking/REIT), growth-stock detection, MOS pre-fill.

### Watchlist merge

`WatchlistStore::mergeSavedFields()` — restores saved thesis/review into empty slots on fetch.

### v2 today

`fetchStockData()` returns ~15 `StockMetrics` fields — insufficient for Full Verify auto-fill.

**Planned:** `buildVerifierAutoFill()` port in `@sv/data-adapters` sharing PHP `mapToVerifierInput()` logic.

---

## Verification engine

`VerificationEngine::run()` (~1,400 lines PHP):

```
sanitize → EpsModeHelper
  → computeDerivedMetrics()      // CfaValuationEngine, Graham, Altman, quality
  → evaluatePhase0() … evaluatePhase8()
  → buildScorecard()               // 0–56 total
  → runRedFlagScan()               // up to 10 flags
  → determineVerdict()             // action, grade, color, summary
  → suggestPositionSize()
  → ExecutiveSummary::build()
  → DataQualityGateHelper::evaluate()
  → investmentReady() options
```

### Scorecard (max 56)

| Phase | Typical max | Critical gates |
|-------|-------------|----------------|
| P0 | 5 | Investor readiness |
| P1 | 8 | Business model, pledge >25% |
| P2 | 8 | CFO vs PAT, receivables |
| P3 | 6 | ROE/ROCE leverage trap |
| P4 | 8 | Value traps, growth fit |
| P5 | 6 | F-Score, Altman Z |
| P6 | 5 | Sector KPIs |
| P7 | 5 | Portfolio fit |
| P8 | 5 | Thesis completeness |

### v2 today

`estimate()` + `matrixVerdict()` — valuation and recommendation only. No phase evaluation, no scorecard rows, no critical fails.

**Golden tests:** `validate-logic.php` fixtures ported for valuation; engine gate tests **not ported**.

---

## Investment-ready gate

`VerificationEngine::investmentReady($result, $options)`:

### Automatable checks

| Check | Threshold |
|-------|-----------|
| Score | ≥ 35 / 56 |
| MOS | ≥ 15% |
| Critical fails | none |
| Red flags | ≤ 1 |
| Data quality | passed |
| MOS sanity | \|MOS\| ≤ extreme threshold |

### Manual checks (block `ready` until complete)

| Check | Phases |
|-------|--------|
| Phase 0 complete | Personal finance gates |
| Phase 1 complete | No critical fail, competence answered |
| Phase 5 complete | Altman not unreliable |
| Phase 7 complete | Portfolio gates answered |
| Phase 8 complete | Thesis + review date |
| Attestation | `manual_attestation` when auto-prefilled |
| Not screening mode | Full Verify only |

### Screening vs full

| Mode | `ready` |
|------|---------|
| `verify.php` (screening) | Always false — banner explains |
| `index.php` + attestation | Can be true |
| `index.php` auto-prefill, no attestation | `automatable_ready` maybe true, `ready` false |

---

## Results panel

PHP sticky sidebar (`index.php` right column):

| Section | Content |
|---------|---------|
| Verdict banner | Action, grade, score, summary |
| Watchlist saved alert | Link to watchlist |
| Executive summary | Conviction, pillars, strengths, risks |
| Phase 0 gate warning | Amber if investor not ready |
| Critical failures | Red list |
| Data quality | Banner + D1–D6 panel |
| CFA summary | Business summary line |
| MOS extreme / valuation flags | Warning banners |
| Metric row | Quality, rating, MOS, intrinsic, DCF, fair P/E, F-Score |
| Position sizing | % suggestion |
| Investment ready badge | Pass/fail + reasons |
| Master scorecard | Phase rows + total |
| Red flag scan | Count + flag list |
| Gate-by-gate | Per-gate pass/fail detail |

### v2 `/verify` today

8-row table: intrinsic, MOS, fair P/E, Graham, quality, method, verdict.

---

## Watchlist integration

### PHP (on `action=verify`)

When `review_date` set:

```php
WatchlistStore::upsert($symbol, [
  'thesis_business', 'thesis_financials', 'thesis_valuation',
  'invalidation_1', 'invalidation_2',
  'review_date', 'last_verified_at',
  'last_score', 'last_mos', 'last_verdict',
]);
```

Watchlist page shows review due dates and links back to Full Verify.

### v2 today

- `PUT /api/v1/watchlist/items` supports `meta.thesis`
- `syncWatchlistFromVerify()` updates score/MOS on **one-click verify** only
- **No** thesis save from Full Verify (feature missing)

**Planned:** `POST /api/v1/verify/full/run` with `save_watchlist: true` when Phase 8 complete.

---

## Cache & draft state

### PHP

| Cache | Use |
|-------|-----|
| `stock/fetch:{SYM}` | Auto-fill source (7d) |
| `stock_verify/verify:{SYM}` | CFA verify result (cross-page IV) |
| Form state | **Session only** — lost on refresh |

### v2 planned

| Store | Use |
|-------|-----|
| `sv:stock:{SYM}` | Fetch & fill |
| `sv:verify:{SYM}` | Screening verify (shared) |
| `verify_drafts` table or `localStorage` | In-progress wizard |
| `verification_runs` | Completed full runs (`mode: 'full'`) |

---

## API mapping (PHP → v2)

| PHP | Planned v2 |
|-----|------------|
| GET `index.php?symbol=TCS` | `GET /api/v1/verify/full/prefill?symbol=TCS` |
| POST `action=fetch` | `POST /api/v1/verify/full/fetch` |
| POST `action=verify` | `POST /api/v1/verify/full/run` |
| POST `action=auto_verify` | Reuse `POST /api/v1/verify/auto` + merge into draft |
| Form state | `PUT /api/v1/verify/full/draft` |
| Results HTML | JSON `result` + client `VerifyFullResults.tsx` |

### Planned run request

```json
{
  "symbol": "TCS",
  "input": { "stock_name": "TCS", "p0_emergency_fund": "1", "..." },
  "save_watchlist": true,
  "manual_attestation": true
}
```

### Planned run response (excerpt)

```json
{
  "success": true,
  "result": {
    "scorecard": { "total": 42, "max": 56, "rows": [] },
    "metrics": { "intrinsic_value": 4200, "margin_of_safety": 8.3, "quality_score": 78 },
    "verdict": { "action": "BUY", "grade": "B", "color": "green" },
    "phases": [],
    "critical_fails": [],
    "red_flag_scan": { "count": 0 },
    "investment_ready": { "ready": true, "reasons": [] },
    "position_size": { "size": "3–5%", "conviction": "Medium" }
  },
  "watchlist_saved": true
}
```

---

## UI surfaces

### Planned `/verify/full`

```
┌─────────────────────────────────────────────────────────────┐
│ Full Verify — 8 phases · link to CFA Verify                  │
├──────────────────────────┬──────────────────────────────────┤
│ Fetch bar: symbol,       │ Results (sticky):                  │
│ Fetch & Fill, CFA link   │ verdict, investment ready,         │
│                          │ scorecard, executive summary       │
│ Phase tabs 0–8           │                                  │
│ Active phase form        │                                  │
│ AUTO badges on fields    │                                  │
│ Next / Back / Submit     │                                  │
└──────────────────────────┴──────────────────────────────────┘
```

### Component plan

| Component | Responsibility |
|-----------|----------------|
| `VerifyFullPage.tsx` | Layout, fetch bar, phase router |
| `VerifyPhase0.tsx` … `VerifyPhase8.tsx` | Phase forms |
| `VerifySectorPanel.tsx` | Phase 6 sector switcher |
| `VerifyFullResults.tsx` | Sticky results sidebar |
| `InvestmentReadyBadge.tsx` | Pass/fail + reasons list |
| `ScorecardTable.tsx` | Master scorecard |

### Cross-links (planned)

- CFA Verify → "Open Full Verify"
- Full Verify → CFA Verify, Stock Details, Screener, Watchlist
- Watchlist row → `/verify/full?symbol=`

---

## Parity matrix

| Feature | PHP | v2 | Gap |
|---------|-----|-----|-----|
| `/verify/full` route | `index.php` | ✗ | **FV-A** |
| 9-phase tabbed form | ✓ | ✗ | **FV-A** |
| Fetch & Fill (~80 fields) | ✓ | ✗ | **FV-B** |
| AUTO field badges | ✓ | ✗ | **FV-A** |
| `FormState` merge logic | ✓ | ✗ | **FV-B** |
| `VerificationEngine` | ✓ | ✗ | **FV-C** |
| Master scorecard 0–56 | ✓ | ✗ | **FV-C** |
| Critical fails / red flags | ✓ | ✗ | **FV-C** |
| Investment ready badge | ✓ | ✗ | **FV-C** |
| Manual attestation | ✓ | ✗ | **FV-C** |
| Executive summary | ✓ | ✗ | **FV-C** |
| Phase 6 sector panels (13) | ✓ | ✗ | **FV-D** |
| Phase 7 exit triggers | ✓ | ✗ | **FV-D** |
| Thesis → watchlist save | ✓ | partial | **FV-D** |
| Promoter pledge overlay | ✓ | holding only | **FV-B** |
| Draft resume | ✗ | planned | v2 improvement |
| Hindi i18n | partial | ✗ | **FV-E** |
| `validate-logic.php` parity | ✓ | valuation only | **FV-E** |
| REST JSON API | ✗ | planned | v2 improvement |

---

## Speed optimization plan

### Phase FV-A — Shell & prefill (3–4 days)

| # | Task |
|---|------|
| FV-A1 | Route `/verify/full` + `VerifyFullPage` layout (split pane) |
| FV-A2 | Phase tab navigation (0–8) with Next/Back |
| FV-A3 | `GET /api/v1/verify/full/prefill?symbol=` — empty form + symbol |
| FV-A4 | AUTO badge component; field metadata from `autoKeys` |
| FV-A5 | Nav + cross-links from CFA Verify, Watchlist |

### Phase FV-B — Fetch & fill (4–5 days)

| # | Task |
|---|------|
| FV-B1 | Port `mapToVerifierInput()` → `buildVerifierAutoFill()` |
| FV-B2 | `POST /api/v1/verify/full/fetch` — returns input + auto_keys |
| FV-B3 | `FormState` equivalent in TypeScript (manual overrides auto) |
| FV-B4 | Watchlist thesis merge on fetch |
| FV-B5 | Promoter pledge from PostgreSQL upload |
| FV-B6 | Draft save: `PUT /api/v1/verify/full/draft` or localStorage |

### Phase FV-C — Engine & results (5–7 days)

| # | Task |
|---|------|
| FV-C1 | Port `VerificationEngine` → `@sv/core/verification-engine.ts` |
| FV-C2 | Port `ExecutiveSummary`, `DataQualityGateHelper` |
| FV-C3 | `POST /api/v1/verify/full/run` |
| FV-C4 | `VerifyFullResults` — verdict, scorecard, investment ready |
| FV-C5 | `investmentReady()` + attestation checkbox on Phase 8 |
| FV-C6 | Persist `verification_runs` with `mode: 'full'` |
| FV-C7 | Port `validate-logic.php` gate tests to vitest |

### Phase FV-D — Sector, portfolio, watchlist (3–4 days)

| # | Task |
|---|------|
| FV-D1 | `VerifySectorPanel` — 13 sector blocks |
| FV-D2 | Phase 7 exit triggers + holding toggle |
| FV-D3 | Phase 8 thesis form + validation |
| FV-D4 | Watchlist save on successful run with `review_date` |
| FV-D5 | Review-date reminders on Watchlist page |

### Phase FV-E — Polish & parity (2–3 days)

| # | Task |
|---|------|
| FV-E1 | `test-cross-page.php` fixtures — IV/MOS vs screener/verify |
| FV-E2 | EPS consolidated/standalone mode (`EpsModeHelper`) |
| FV-E3 | Optional Hindi strings for phase labels |
| FV-E4 | Mobile-responsive phase forms |

### Acceptance criteria

- [ ] `index.php?symbol=TCS` parity: scorecard total within **2 points** of PHP for same input fixture
- [ ] Investment ready false in screening mode; true only with attestation + manual phases
- [ ] Fetch & fill warm p95 < **200ms**
- [ ] Full run (engine only) p95 < **300ms**
- [ ] Thesis + review date saved to watchlist on verify
- [ ] CFA Verify links to Full Verify with symbol prefill

---

## Implementation phases

```
Now — no Full Verify
  │
  ├─► FV-A: Route + phase shell + prefill URL
  │
  ├─► FV-B: buildVerifierAutoFill + fetch API + draft
  │
  ├─► FV-C: VerificationEngine + results + investment ready
  │
  ├─► FV-D: Sector panels + thesis watchlist
  │
  └─► FV-E: Parity tests + i18n + mobile
```

**Overlap with [CFA-VERIFY.md](CFA-VERIFY.md):** V-C (engine port) = FV-C1. Implement once in `@sv/core`; both docs reference the same package.

---

## File reference

### Script Screener (v2) — existing (partial)

```
packages/core/src/cfa-valuation-engine.ts   Valuation inside engine
packages/core/src/mos-helper.ts             estimate() — screening only
packages/data-adapters/src/stock-data-fetcher.ts
apps/api/src/services/verify.ts             One-click verify only
apps/web/src/pages/VerifyPage.tsx
```

### Script Screener (v2) — planned

```
packages/core/src/verification-engine.ts
packages/core/src/executive-summary.ts
packages/core/src/data-quality-gate.ts
packages/data-adapters/src/verifier-autofill.ts
apps/api/src/services/verify-full.ts
apps/web/src/pages/VerifyFullPage.tsx
apps/web/src/components/verify-full/*
```

### PHP reference (stock-verifier)

```
index.php                          ~950 lines — form + results
includes/FormState.php             Auto/manual merge
includes/VerificationEngine.php    ~1400 lines — 8 phases
includes/StockDataFetcher.php      buildVerifierAutoFill, mapToVerifierInput
includes/ExecutiveSummary.php
includes/DataQualityGateHelper.php
includes/EpsModeHelper.php
includes/data_quality_ui.php       Results banners
includes/WatchlistStore.php        mergeSavedFields, upsert on verify
validate-logic.php                 Golden engine tests
test-cross-page.php                IV/MOS cross-page parity
docs/USER-GUIDE.md                 Analyst workflow
```

---

## Related docs

- [CFA Verify](CFA-VERIFY.md) — one-click screening; shares valuation engine
- [Stock Details](STOCK-DETAILS.md) — links to Full Verify for IV drift
- [CFA Screener](SCREENER.md) — funnel into Full Verify after screen
- [Web UI](WEB-UI.md) — routes
- [API Reference](API.md) — verify endpoints (to extend)
- [MIGRATION.md](MIGRATION.md) — PHP page mapping
- [Development Milestones](MILESTONES.md) — M3 valuation, engine port TBD
