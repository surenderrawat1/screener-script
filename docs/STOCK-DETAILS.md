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
| **Closest v2 page** | — | `/verify` (~30% of content) |

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
| Verify result | `stock_verify/verify:{SYM}` | `sv:verify:{SYM}` (planned) |

Redis enables sub-ms reads on warm cache vs SQLite/file I/O.

### 2. Split API endpoints (planned)

PHP loads everything in one heavy PHP request. v2 can split:

```
GET /stock/:symbol/summary     → fundamentals + valuation  (<50KB, <200ms cached)
GET /stock/:symbol/chart       → OHLC bars only            (lazy load chart)
GET /stock/:symbol/profile     → Screener HTML parse       (on demand)
```

First paint faster; chart loads after hero + valuation.

### 3. Parallel fetch (planned)

PHP sequential: Yahoo → Screener → profile fallback.

v2 target:

```typescript
await Promise.all([
  fetchYahooFundamentals(symbol),
  fetchScreenerRatios(symbol),
  fetchDailyBars(symbol),      // if chart requested
]);
```

Cold load target: **<2s** vs PHP **2–4s**.

### 4. Shared cache with screener/verify

Symbol viewed on Stock Details after screener scan → `sv:stock` hit → no refetch.

Today VerifyPage always sends `refresh: true` — **bypasses cache**. Stock Details should default `refresh=false` and offer explicit refresh button.

### Latency budget (planned)

| Action | Target (warm) | Target (cold) |
|--------|---------------|---------------|
| Summary API (no chart) | p95 < **200ms** | p95 < **2s** |
| Chart bars endpoint | p95 < **300ms** | p95 < **1.5s** |
| Profile endpoint | p95 < **500ms** | p95 < **3s** (HTML scrape) |
| Full page first paint | < **1s** | < **3s** |

---

## System architecture (planned)

```
┌──────────────┐  GET /api/v1/stock/:symbol     ┌─────────────┐
│ StockDetails │ ◄──────────────────────────────►│   Fastify   │
│    Page      │  GET .../chart  GET .../profile   └──────┬──────┘
│ /stock/:sym  │                                         │
└──────────────┘                                         ▼
                              ┌────────────────────────────────────┐
                              │ stock-details.ts (planned service) │
                              └──────────────┬─────────────────────┘
                                             │
         ┌───────────────────────────────────┼───────────────────────────┐
         ▼                   ▼               ▼               ▼           ▼
  fetchStockData      verifyStock/      fetchDailyBars   fetchScreener   prisma
  (yahoo+screener)    estimate()        metricsFromBars  Profile (new)  promoter
         │                   │               │               │
         └───────────────────┴───────────────┴───────────────┘
                                     Redis sv:*
```

### v2 building blocks today

| Block | Package | Used by |
|-------|---------|---------|
| `fetchStockData` | `@sv/data-adapters` | Screener, Verify |
| `verifyStock` / `estimate` | `@sv/core` + adapters | Verify API |
| `fetchDailyBars` | `swing-chart.ts` | Swing scan |
| `metricsFromBars` | `@sv/swing/ta-helper` | Swing evaluate |
| Company profile parser | — | **Missing** |
| Chart phase analysis | — | **Missing** |

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

### v2 today (fragmented)

**Verify only:**

```
POST /api/v1/verify/auto
  → verifyStock(symbol, refresh=true)
       → fetchStockData → estimate()
       → promoter overlay from PostgreSQL
  → persist verification_runs
  → sync watchlist meta
```

**Swing (not exposed as stock details):**

```
buildSymbolContext(symbol)
  → fetchDailyBars → metricsFromBars → evaluateEntry
```

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

Cache: `screener/profile:consolidated:{slug}` — 7d TTL.

### v2

`screener-in.ts` fetches **ratio tiles only** — no HTML profile parse.

**Planned:** `packages/data-adapters/src/screener-profile.ts`  
Redis: `sv:screener:profile:{slug}` TTL 7d (new prefix).

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

`fetchDailyBars(symbol)` in `swing-chart.ts` — same 2y Yahoo data, cached `sv:ta:bars:{SYM}` 24h.

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

- `verifyStock()` → `fetchStockData` + `estimate()` from `@sv/core`
- Persists every run to `verification_runs`
- **No IV drift UI**
- **No** `sv:verify` cache wired (Phase 9 roadmap)

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
| `sv:screener:row:*` | 1h–24h | Ratios |
| `sv:ta:bars:{SYM}` | 24h | Chart (when wired) |
| `sv:verify:{SYM}` | 7d | **Not wired** |

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

### v2 (planned)

| Route | Link from |
|-------|-----------|
| `/stock/:symbol` or `/details?symbol=` | Screener rows, Verify, Watchlist, Dashboard |

---

## API mapping (PHP → v2)

| PHP | Planned v2 |
|-----|------------|
| GET `stock-details.php?symbol=TCS` | `GET /api/v1/stock/TCS` |
| POST `action=refresh_live` | `POST /api/v1/stock/TCS/refresh` |
| Embedded chart JSON | `GET /api/v1/stock/TCS/chart` |
| Profile in same page | `GET /api/v1/stock/TCS/profile` |
| — | `GET /api/v1/stock/TCS/summary` (fundamentals + valuation + TA, no profile) |

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
| Dedicated page/route | ✓ | ✗ | **SD-A** |
| Nav + cross-links | ✓ | ✗ | **SD-A** |
| Rich fundamentals (30+ fields) | ✓ | ~15 fields | **SD-B** |
| Company profile | ✓ | ✗ | **SD-B** |
| Concalls table | ✓ | ✗ | **SD-B** |
| Expenditures / plans | ✓ | ✗ | **SD-B** |
| Promoter pledge | ✓ | holding only | **SD-B** |
| Daily chart UI | ✓ | ✗ | **SD-C** |
| Chart phase analysis | ✓ | ✗ | **SD-C** |
| TA metrics grid | ✓ | ✗ | **SD-C** |
| CFA valuation block | ✓ | partial `/verify` | **SD-A** |
| IV drift warning | ✓ | ✗ | **SD-A** |
| Admin cache refresh | ✓ | ✗ | **SD-D** |
| Cross-page parity test | ✓ | ✗ | **SD-D** |
| JSON API | ✗ (SSR only) | planned | v2 improvement |

---

## Speed optimization plan

### Phase SD-A — Summary API + page shell (2–3 days)

| # | Task |
|---|------|
| SD-A1 | `GET /api/v1/stock/:symbol` — `fetchStockData` + `verifyStock` (refresh=false default) |
| SD-A2 | `StockDetailsPage.tsx` at `/stock/:symbol` |
| SD-A3 | Hero + valuation + fundamentals grid (from existing metrics) |
| SD-A4 | Details links on Screener, Verify, Watchlist |
| SD-A5 | IV drift: dual `estimate()` paths + warning banner |

### Phase SD-B — Profile & rich fundamentals (3–4 days)

| # | Task |
|---|------|
| SD-B1 | Port `ScreenerCompanyProfile` → `screener-profile.ts` |
| SD-B2 | `GET /api/v1/stock/:symbol/profile` lazy endpoint |
| SD-B3 | Expand `mergeMetrics` / Yahoo parse: P/B, PEG, 52w, margins, CFO, capex |
| SD-B4 | Promoter pledge upload or scrape |
| SD-B5 | UI: about, concalls, expenditures, business plans |

### Phase SD-C — Chart & TA (2–3 days)

| # | Task |
|---|------|
| SD-C1 | `GET /api/v1/stock/:symbol/chart` — `fetchDailyBars` + SMA series |
| SD-C2 | Lightweight Charts component (lazy load) |
| SD-C3 | Port `chartPhaseAnalysis` → `@sv/swing/chart-phase.ts` |
| SD-C4 | TA metrics grid from `metricsFromBars` |
| SD-C5 | Phase analysis cards + crossover list |

### Phase SD-D — Ops & parity (1–2 days)

| # | Task |
|---|------|
| SD-D1 | `POST /api/v1/stock/:symbol/refresh` (permission `refresh_data`) |
| SD-D2 | Wire `sv:verify` cache (share with verify/screener) |
| SD-D3 | Parity test vs PHP `test-cross-page.php` fixtures |
| SD-D4 | Parallel Yahoo + Screener fetch in `fetchStockData` |

### Acceptance criteria

- [ ] `/stock/TCS` loads summary p95 < **200ms** (warm cache)
- [ ] Cold load p95 < **3s** (summary only, no chart)
- [ ] Chart lazy-loads in second request < **500ms** cached
- [ ] MOS/IV matches PHP `test-cross-page.php` for TCS, RELIANCE fixtures
- [ ] Screener row → Details navigation works
- [ ] Admin refresh clears symbol caches and refetches
- [ ] Chart phases shown with "timing context only" disclaimer

---

## Implementation phases

```
Now — no Stock Details page
  │
  ├─► SD-A: Summary API + page + cross-links + valuation
  │
  ├─► SD-B: Screener profile + rich fundamentals
  │
  ├─► SD-C: Chart + phase analysis + TA grid
  │
  └─► SD-D: Admin refresh + verify cache + parity tests
```

---

## File reference

### Script Screener (v2) — existing

```
packages/data-adapters/src/stock-data-fetcher.ts   fetchStockData, mergeMetrics
packages/data-adapters/src/yahoo.ts
packages/data-adapters/src/screener-in.ts
packages/data-adapters/src/swing-chart.ts          fetchDailyBars
packages/data-adapters/src/screener-run.ts       verifyStock
packages/swing/src/ta-helper.ts                  metricsFromBars
packages/core/src/cfa-valuation-engine.ts
apps/api/src/services/verify.ts
apps/web/src/pages/VerifyPage.tsx                closest UI (~30%)
```

### Script Screener (v2) — planned

```
packages/data-adapters/src/screener-profile.ts
packages/swing/src/chart-phase.ts
apps/api/src/services/stock-details.ts
apps/web/src/pages/StockDetailsPage.tsx
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
