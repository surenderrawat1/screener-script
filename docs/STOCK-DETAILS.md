# Stock Details — Architecture & Speed Plan

**Stock Details** is the single-symbol research hub: live fundamentals, CFA valuation, company profile (Screener.in), daily price chart, chart phase analysis, and a full technical metrics grid — with cross-links to Verify, Screener, Swing, Strategies, and Watchlist.

In **Script Screener v2 this page is implemented** as `/stock/:symbol`, backed by `GET /api/v1/stock/:symbol`, `/chart`, `/profile`, and `/refresh`. Current accuracy rules are maintained in [High Accuracy Architecture & CFA Calculation Rules](HIGH-ACCURACY-ARCHITECTURE.md).

> Educational research only — chart phases are timing context and are **not** blended into CFA scores (same rule as PHP).

---

## Table of contents

1. [What it does](#what-it-does)
2. [PHP vs Script Screener](#php-vs-script-screener)
3. [Why the new architecture can be faster](#why-the-new-architecture-can-be-faster)
4. [System architecture (planned)](#system-architecture-planned)
5. [Data pipeline](#data-pipeline)
6. [UI sections (PHP reference)](#ui-sections-php-reference)
7. [Company profile](#company-profile)
8. [Charts & phase analysis](#charts--phase-analysis)
9. [Verify integration](#verify-integration)
10. [Cache layers](#cache-layers)
11. [Cross-page links](#cross-page-links)
12. [API mapping (PHP → v2)](#api-mapping-php--v2)
13. [Parity matrix](#parity-matrix)
14. [Speed optimization plan](#speed-optimization-plan)
15. [Implementation phases](#implementation-phases)
16. [File reference](#file-reference)

---

## What it does

| Capability | Description |
|------------|-------------|
| **Symbol lookup** | Search any NSE symbol (e.g. TCS, RELIANCE) |
| **Fundamentals** | P/E, P/B, ROE, ROCE, margins, debt, FCF, promoter holding/pledge |
| **CFA valuation** | Intrinsic value, MOS %, fair P/E, quality score, rating |
| **IV drift check** | Screener fast-path IV vs Full Verify engine (PHP) |
| **Business profile** | About, key points, website, BSE/NSE codes |
| **Concalls** | Transcript, PPT, recording, AI summary links |
| **Expenditures** | Cash-flow line items from Screener tables |
| **Business plans** | Outlook keywords from Screener text |
| **Daily chart** | 2y candlesticks + SMA 9/20/50/200 (Lightweight Charts) |
| **Chart phases** | 6-phase bias analysis (trend, MA stack, RSI, 52w, vol, MACD) |
| **TA grid** | RSI, 52w %, SMAs, MACD, Bollinger, bottom-out hint |
| **Admin refresh** | Purge all caches for symbol and refetch |

---

## PHP vs Script Screener

| Aspect | PHP (`stock-verifier`) | Script Screener (`stock-verifier-v2`) |
|--------|------------------------|--------------------------------------|
| **Page** | `stock-details.php?symbol=TCS` | `/stock/:symbol` |
| **API** | Server-rendered HTML only (no JSON API) | `GET /api/v1/stock/:symbol` plus chart/profile/refresh endpoints |
| **Nav** | App nav item "Details" | Details route available from Verify and symbol workflows |
| **Data fetch** | `StockDataFetcher::fetch()` — 30+ fields | `resolveStockMetrics()` + Screener annual enrichment |
| **Company profile** | `ScreenerCompanyProfile.php` | `fetchScreenerProfile()` profile/expenditures |
| **Daily chart** | Lightweight Charts inline | `StockDailyChart` via `/chart` endpoint |
| **Phase analysis** | `chartPhaseAnalysis()` | `chartPhaseAnalysis()` in API response |
| **TA display grid** | 15+ metrics on page | Details TA grid from `@sv/swing` metrics |
| **Valuation** | `CfaAutoVerifier::runFromFetch()` + MOS drift | `getStockSummary()` quick valuation from same enriched metrics shown on page |
| **Refresh** | Admin POST clears 6 cache prefixes | Details `Clear cache & reload` clears symbol cache and reloads enriched summary |
| **Inbound links** | Screener, Verify, Watchlist rows | Details links from Verify/Full Verify/Swing flows |
| **Closest v2 page** | — | `/stock/:symbol` (full hub; Verify is valuation-only subset) |

**Note:** PHP has no `stock-details-api.php`. Chart JSON is embedded in the HTML page, not fetched via XHR.

---

## Why the new architecture can be faster

### 1. Redis vs SQLite file cache

| Layer | PHP `DataCache` | v2 Redis |
|-------|-----------------|----------|
| Stock fundamentals | `stock/fetch:{SYM}` 7d | `sv:stock:{SYM}` 7d |
| Yahoo raw | `yahoo/{SYM.NS}` | `sv:yahoo:*` |
| Screener ratios | `screener/{slug}` | `sv:screener:row:*` |
| TA daily bars | `ta/closes:{SYM}` 24h | `sv:ta:bars:{SYM}` 24h |
| Verify result | `stock_verify/verify:{SYM}` | `sv:verify:{SYM}` (wired) |

Redis enables sub-ms reads on warm cache vs SQLite/file I/O.

### 2. Split API endpoints (shipped)

PHP loads everything in one heavy PHP request. v2 splits:

```
GET /api/v1/stock/:symbol          → fundamentals + valuation + IV drift (default refresh=false)
GET /api/v1/stock/:symbol/chart    → OHLC + TA + phases + chart patterns (lazy)
GET /api/v1/stock/:symbol/profile  → Screener.in profile (lazy)
POST /api/v1/stock/:symbol/refresh → admin cache purge + refetch
```

First paint: summary hero loads; chart, profile, and swing context load in parallel after mount.

### 3. Parallel fetch (shipped)

`resolveStockMetrics()` and chart/profile loaders use `Promise.all` where independent (Yahoo + Screener row + bars).

### 4. Shared cache with screener/verify

Symbol viewed on Stock Details after screener scan → `sv:stock` hit → no refetch.

Today VerifyPage may send `refresh: true` — Stock Details defaults `refresh=false` and offers **Clear cache & reload** (admin `refresh_data` permission).

### Latency budget (targets)

| Action | Target (warm) | Target (cold) |
|--------|---------------|---------------|
| Summary API (no chart) | p95 < **200ms** | p95 < **2s** |
| Chart bars endpoint | p95 < **300ms** | p95 < **1.5s** |
| Profile endpoint | p95 < **500ms** | p95 < **3s** (HTML scrape) |
| Full page first paint | < **1s** | < **3s** |

---

## System architecture (shipped)

```
┌──────────────┐  GET /api/v1/stock/:symbol     ┌─────────────┐
│ StockDetails │ ◄──────────────────────────────►│   Fastify   │
│    Page      │  GET .../chart  GET .../profile   └──────┬──────┘
│ /stock/:sym  │  POST .../refresh                         │
└──────────────┘                                         ▼
                              ┌────────────────────────────────────┐
                              │ apps/api/src/services/stock-details.ts │
                              └──────────────┬─────────────────────┘
                                             │
         ┌───────────────────────────────────┼───────────────────────────┐
         ▼                   ▼               ▼               ▼           ▼
  resolveStockMetrics   screenSymbol/    buildDailyChart   fetchScreener   prisma
  (yahoo+screener)      estimate()       chartPhaseAnalysis Profile      verify history
         │                   │               │               │
         └───────────────────┴───────────────┴───────────────┘
                                     Redis sv:*
```

### v2 building blocks

| Block | Package | Used by |
|-------|---------|---------|
| `resolveStockMetrics` | `@sv/data-adapters` | Stock Details, Screener, Verify |
| `screenSymbol` / `estimate` | `@sv/core` + adapters | Stock summary valuation |
| `buildDailyChartPayload` | `@sv/swing` | Chart endpoint |
| `metricsFromBars` / `enrichDetailTa` | `@sv/swing` | TA grid on chart load |
| `fetchScreenerProfile` | `@sv/data-adapters/screener-profile.ts` | Profile endpoint |
| `chartPhaseAnalysis` | `@sv/swing/chart-phase.ts` | Phase cards on chart |
| `detectChartPatterns` | `@sv/swing/chart-patterns.ts` | Pattern overlays + MTF |

---

## Data pipeline

### PHP (`stock-details.php`)

```
symbol
  → StockDataFetcher::fetch()
       Yahoo quoteSummary
       Screener.in consolidated + standalone HTML
       PromoterHoldingLoader, PromoterPledgeLoader
       business_profile embedded in fetch
  → TechnicalAnalysisHelper::metricsForStock()
  → TechnicalAnalysisHelper::dailyChartForSymbol()  // 2y daily
  → TechnicalAnalysisHelper::chartPhaseAnalysis()
  → CfaAutoVerifier::runFromFetch()                 // Full Verify engine
  → MosHelper::estimate()                           // Fast-path IV for drift
  → LiveParityChecker::ivDeltaPercent()
  → [fallback] ScreenerCompanyProfile::fetch(slug)
```

### v2 today (unified hub)

```
GET /api/v1/stock/:symbol
  → resolveStockMetrics(refresh=false default)
  → screenSymbol → valuation block + IV drift vs last Full Verify
  → last verification_runs memo snippet
  → data_quality banner

GET /api/v1/stock/:symbol/chart
  → buildDailyChartPayload + chartPhaseAnalysis + detectChartPatterns

GET /api/v1/stock/:symbol/profile
  → fetchScreenerProfile (about, concalls, expenditures, business plans)

POST /api/v1/stock/:symbol/refresh
  → cacheClearSymbol + parallel refetch (admin)
```

**StockDetailsPage** lazy-loads chart, profile, and swing context after summary; renders memo layout, TA grid, phase cards, pattern overlays, and cross-links to Verify / Full Verify / Patterns / Swing.

---

## UI sections (PHP reference)

Render order on `stock-details.php`:

| # | Section | v2 status |
|---|---------|-----------|
| 1 | Hero — company, sector, price, sources, cache flag | Planned |
| 2 | Quick ratios — MCap, P/E, P/B, PEG | Partial (verify shows subset) |
| 3 | Valuation — IV, MOS, fair P/E, rating, IV drift | Partial (`/verify`) |
| 4 | Business Details — about, key points, exchanges | **Missing** |
| 5 | Expenditures & cash flows | **Missing** |
| 6 | Business plans & outlook | **Missing** |
| 7 | Concall & investor updates table | **Missing** |
| 8 | Fundamental grid (20+ metrics) | **Missing** |
| 9 | Yahoo summary fallback | **Missing** |
| 10 | Daily candlestick chart + SMA overlays | **Missing** |
| 11 | Chart phase analysis (6 phases) | **Missing** |
| 12 | Technical details grid | **Missing** |
| 13 | Footer — Verify, Full Verify, Quality Screener | **Missing** |

### v2 `/verify` today

Shows: intrinsic, MOS, fair P/E, Graham, quality score, method, verdict, sources, history sidebar.

Does not show: price hero, P/B, PEG, profile, chart, TA, screener drill-down.

---

## Company profile

### PHP (`ScreenerCompanyProfile.php`)

Scrapes Screener.in consolidated page HTML:

| Field | Content |
|-------|---------|
| `about` | Company description |
| `key_points` | Bullet highlights |
| `website` | Corporate URL |
| `bse_code` / `nse_symbol` | Exchange codes |
| `concalls[]` | Period, transcript, PPT, recording, AI summary URLs |
| `expenditures` | Cash-flow table rows (Rs Cr) |
| `business_plans` | Keyword-extracted outlook highlights |

Cache: profile/annual data is treated as Screener table data — default 24h via `cache_ttl.screener_table`.

### v2

`screener-profile.ts` parses profile, expenditures, concalls, and business-plan highlights.

Redis: `sv:screener:table:profile:{mode}:{slug}` with runtime TTL from `data-policy.yaml`.

---

## Charts & phase analysis

### Daily chart (PHP)

- `TechnicalAnalysisHelper::dailyChartForSymbol()` — 2y daily (`CHART_RANGE = '2y'`)
- Yahoo `interval=1d`
- Client: `lightweight-charts` standalone JS
- Payload embedded in page `<script>`:

```json
{
  "symbol": "TCS",
  "bars": [{ "time": "YYYY-MM-DD", "open", "high", "low", "close", "volume" }],
  "sma9": [{ "time", "value" }],
  "sma20": [], "sma50": [], "sma200": []
}
```

### v2 adapter

`fetchDailyBars(symbol)` in `swing-chart.ts` — same 2y Yahoo data, cached `sv:ta:bars:{SYM}` with runtime `ta` TTL.

**Not exposed** to any web page.

### Chart phase analysis (PHP only)

`chartPhaseAnalysis(price, ta, dailyChart)` returns:

| Phase | Title |
|-------|-------|
| 1 | Primary Trend (SMA-200) |
| 2 | MA Alignment (9/50/200 stack) |
| 3 | Short-term Momentum (RSI + SMA-9) |
| 4 | 52-Week Cycle |
| 5 | Volatility (Bollinger) |
| 6 | MACD Momentum |

Plus `bias` (bullish/bearish/neutral), `crossovers[]`, `observations[]`.

**Design rule:** Phases are **informational only** — not inputs to CFA score.

**Planned port:** `@sv/swing/chart-phase.ts` or `@sv/core/chart-phase.ts`.

### TA metrics grid (PHP displays)

`metricsForStock` fields include: `ta_rsi14`, `ta_pct_52w`, `ta_sma20/50/200`, `ta_above_sma*`, `ta_macd_hist`, `ta_bb_pct_b`, `ta_bottom_out_score`, etc.

v2 `metricsFromBars()` computes similar fields — usable once wired to Stock Details API.

---

## Verify integration

### PHP

- **Primary valuation:** `CfaAutoVerifier::runFromFetch($fetch)` — full `VerificationEngine` on fetched payload
- **Does not write** verify cache on page view
- **Drift warning:** `MosHelper::estimate()` screener IV vs verify IV; warn if drift > **10%** (`LiveParityChecker::IV_DRIFT_WARN_PCT`)

### v2

- `getStockSummary()` → `resolveStockMetrics()` + `screenSymbol()` from the same enriched metrics shown on the page
- Persists every run to `verification_runs`
- IV drift warning compares fast-path IV and Full Verify IV when both are available
- `sv:verify` is used by CFA Verify; Stock Details quick valuation stays metric-local to avoid cross-cache drift

Stock Details should reuse verify engine output without forcing `refresh: true` on every page load.

---

## Cache layers

### PHP refresh (`sdRefreshLiveData`)

Admin POST clears for symbol:

| Prefix | Keys |
|--------|------|
| `stock` | `fetch:{SYM}` |
| `stock_alias` | alias mappings |
| `screener` | slug + profile matches |
| `yahoo` | `{SYM.NS}`, `{SYM.BO}` |
| `ta` | `closes:{SYM}` |
| `stock_verify` | `verify:{SYM}` |

Requires permission `refresh_data` + CSRF.

### v2 (today)

| Key | TTL | Stock Details use |
|-----|-----|-------------------|
| `sv:stock:{SYM}` | 7d | Fundamentals |
| `sv:yahoo:*` | 7d | Raw Yahoo |
| `sv:screener:table:*` | 24h | Ratios/profile/annual inputs |
| `sv:screener:row:*` | 1h | Analyzed rows |
| `sv:ta:bars:{SYM}` | 24h | Chart / TA |
| `sv:verify:{SYM}` | 7d | CFA Verify memo cache |

### Planned admin refresh API

```http
POST /api/v1/stock/TCS/refresh
```

Permission: `refresh_data` — delete all `sv:*` keys for symbol (mirror PHP).

---

## Cross-page links

### PHP inbound (→ stock-details)

| Source | Link |
|--------|------|
| `screener.php` | Details button per row |
| `verify.php` | Stock Details link |
| `watchlist.php` | Symbol link |
| `index.php` / nav | Details nav item |

### PHP outbound (← stock-details)

| Target | Purpose |
|--------|---------|
| `verify.php?symbol=` | CFA Verify |
| `index.php?symbol=&mode=auto` | Full Verify |
| `screener.php?run=1&preset=quality` | Quality screener |
| Screener.in | External profile |
| Company website | From profile |

### v2 (shipped)

| Route | Link from |
|-------|-----------|
| `/stock/:symbol` | Screener rows (`SignalCard`), Verify, Watchlist, Morning, Strategies, Signals, Compare, LTG Auto, Patterns feed, nav **Details** |

Outbound from Stock Details: Verify, Full Verify, Screener presets, Patterns, Swing scan, external Screener.in / company site.

---

## API mapping (PHP → v2)

| PHP | v2 |
|-----|-----|
| GET `stock-details.php?symbol=TCS` | `GET /api/v1/stock/TCS` |
| POST `action=refresh_live` | `POST /api/v1/stock/TCS/refresh` |
| Embedded chart JSON | `GET /api/v1/stock/TCS/chart` |
| Profile in same page | `GET /api/v1/stock/TCS/profile` |
| Stored pattern snapshots | `GET /api/v1/stock/TCS/patterns/stored` |

### Proposed summary response shape

```json
{
  "symbol": "TCS",
  "company_name": "Tata Consultancy Services",
  "sector": "Technology",
  "price": 3850,
  "sources": ["yahoo", "screener.in"],
  "from_cache": true,
  "metrics": { "pe": 28, "roe": 52, "..." },
  "valuation": {
    "intrinsic": 4200,
    "mos": 8.3,
    "fair_pe": 32,
    "quality_score": 78,
    "recommendation": "Buy",
    "iv_drift_pct": null
  },
  "ta": {
    "ta_rsi14": 58,
    "ta_pct_52w": 55,
    "ta_ready": true
  },
  "phase": { "bias": "bullish", "phases": [], "crossovers": [] },
  "profile": null,
  "chart_meta": { "bar_count": 504, "range": "2y" }
}
```

---

## Parity matrix

| Feature | PHP | v2 | Gap |
|---------|-----|-----|-----|
| Dedicated page/route | ✓ | ✓ | `/stock/:symbol` |
| Nav + cross-links | ✓ | ✓ | Nav + SignalCard + Verify/Watchlist/Morning |
| Rich fundamentals (30+ fields) | ✓ | ✓ | Metrics grid on `StockDetailsPage` |
| Company profile | ✓ | ✓ | Lazy `/profile` + fallback from metrics |
| Concalls table | ✓ | ✓ | From Screener profile |
| Expenditures / plans | ✓ | ✓ | Profile + fundamental fallback |
| Promoter pledge | ✓ | ✓ | Parsed from Screener.in meta/cons/ratio tiles |
| Daily chart UI | ✓ | ✓ | `StockDailyChart` (Lightweight Charts) |
| Chart phase analysis | ✓ | ✓ | `@sv/swing/chart-phase.ts` |
| Chart patterns + MTF | partial | ✓ | v2 ahead — pattern overlays on chart |
| TA metrics grid | ✓ | ✓ | From chart endpoint + fundamentals merge |
| CFA valuation block | ✓ | ✓ | Summary valuation + last verify snippet |
| IV drift warning | ✓ | ✓ | Cached verify IV vs screener fast-path on summary |
| Admin cache refresh | ✓ | ✓ | `POST .../refresh` + Clear cache button |
| Cross-page parity test | ✓ | ✓ | TCS IV/MOS + RELIANCE/HDFCBANK pledge/insights/shareholding in `cross-page-parity.test.ts` |
| JSON API | ✗ (SSR only) | ✓ | v2 improvement |
| Swing context on page | ✗ | ✓ | v2 ahead — inline swing evaluate |

---

## Speed optimization plan

### Phase SD-A — Summary API + page shell — **Shipped**

| # | Task |
|---|------|
| SD-A1 | `GET /api/v1/stock/:symbol` — `resolveStockMetrics` + valuation (refresh=false default) | **Shipped** |
| SD-A2 | `StockDetailsPage.tsx` at `/stock/:symbol` | **Shipped** |
| SD-A3 | Hero + valuation + fundamentals grid | **Shipped** |
| SD-A4 | Details links on Screener, Verify, Watchlist, Morning, etc. | **Shipped** |
| SD-A5 | IV drift: dual-path + warning banner | **Shipped** |

### Phase SD-B — Profile & rich fundamentals — **Shipped**

| # | Task |
|---|------|
| SD-B1 | Port `ScreenerCompanyProfile` → `screener-profile.ts` | **Shipped** |
| SD-B2 | `GET /api/v1/stock/:symbol/profile` lazy endpoint | **Shipped** |
| SD-B3 | Expand metrics: P/B, PEG, 52w, margins, CFO, capex | **Shipped** |
| SD-B4 | Promoter pledge upload or scrape | **Shipped** — pledge overlay on Details + Full Verify |
| SD-B5 | UI: about, concalls, expenditures, business plans | **Shipped** |

### Phase SD-C — Chart & TA — **Shipped**

| # | Task |
|---|------|
| SD-C1 | `GET /api/v1/stock/:symbol/chart` — daily bars + SMA series | **Shipped** |
| SD-C2 | Lightweight Charts component (lazy load) | **Shipped** |
| SD-C3 | Port `chartPhaseAnalysis` → `@sv/swing/chart-phase.ts` | **Shipped** |
| SD-C4 | TA metrics grid from chart + fundamentals | **Shipped** |
| SD-C5 | Phase analysis cards + pattern overlays | **Shipped** (v2 ahead of PHP patterns UI) |

### Phase SD-D — Ops & parity — **Partial**

| # | Task |
|---|------|
| SD-D1 | `POST /api/v1/stock/:symbol/refresh` (permission `refresh_data`) | **Shipped** |
| SD-D2 | Wire `sv:verify` cache (share with verify/screener) | **Shipped** — parity hint + price-drift invalidate |
| SD-D3 | Parity test vs PHP `test-cross-page.php` fixtures | **Shipped** — TCS IV/MOS + RELIANCE/HDFCBANK governance fixtures |
| SD-D4 | Parallel Yahoo + Screener fetch in stock loaders | **Shipped** |

### Acceptance criteria

- [x] `/stock/TCS` loads summary (warm cache typically < 300ms)
- [x] Chart lazy-loads in second request
- [x] MOS/IV cross-page test for TCS fixture
- [x] Screener row → Details navigation (`SignalCard`)
- [x] Admin refresh clears symbol caches and refetches
- [x] Chart phases shown with "timing context only" disclaimer
- [x] Promoter pledge % on Details page (Screener.in + warehouse upload)
- [x] RELIANCE/HDFCBANK governance fixtures (unknown pledge ≠ 0%, Screener flags → verify gates)
- [x] Cross-page parity for TCS, RELIANCE, HDFCBANK fixtures

---

## Implementation phases

```
Shipped — SD-A through SD-C (summary, profile, chart, phases, patterns)
  │
  └─► SD-D complete for verify cache; optional: Stock Details write-through on page view
```

---

## File reference

### Script Screener (v2) — shipped

```
apps/api/src/services/stock-details.ts       getStockSummary, chart, profile, refresh
packages/data-adapters/src/stock-data-fetcher.ts   resolveStockMetrics
packages/data-adapters/src/screener-profile.ts   fetchScreenerProfile
packages/data-adapters/src/stock-refresh.ts       cacheClearSymbol orchestration
packages/swing/src/chart-phase.ts                chartPhaseAnalysis
packages/swing/src/chart-patterns.ts             detectChartPatterns (Details overlays)
apps/web/src/pages/StockDetailsPage.tsx          full UI hub
apps/web/src/components/StockDailyChart.tsx        Lightweight Charts
packages/data-adapters/src/cross-page-parity.test.ts   TCS IV/MOS fixture
apps/web/src/pages/VerifyPage.tsx                valuation subset + link to Details
```

### PHP reference (stock-verifier)

```
stock-details.php
includes/StockDataFetcher.php
includes/ScreenerCompanyProfile.php
includes/TechnicalAnalysisHelper.php      metricsForStock, dailyChart, chartPhaseAnalysis
includes/CfaAutoVerifier.php
includes/MosHelper.php
includes/LiveParityChecker.php
test-cross-page.php                       parity audit
```

---

## Related docs

- [CFA Screener](SCREENER.md) — universe scan; row Details link planned here
- [CFA Verify](CFA-VERIFY.md) — valuation engine shared with verify page
- [Full Verify](FULL-VERIFY.md) — allocation gate; IV drift target for Stock Details
- [API Reference](API.md) — verify endpoints today
- [Redis & Cache](REDIS-CACHE.md) — `sv:stock`, `sv:ta` keys
- [Web UI](WEB-UI.md) — routes (Stock Details to be added)
- [Roadmap Phase 9](ROADMAP.md) — `sv:verify` cache
