# Stock Verifier - Complete App Documentation and Node/React Migration Guide

**Date:** 2026-07-06  
**Audience:** Software architects, backend engineers, frontend engineers, QA, and financial-product reviewers  
**Lens:** Senior CFA + software architecture  
**Current stack:** PHP 8.1+ single-server web app with JSON/SQLite/file cache  
**Target stack:** Node.js API + React UI + durable database + background workers  

This document explains the existing Stock Verifier application and gives a practical blueprint for converting it to a Node/React architecture without losing financial behavior, scoring parity, or data-quality controls.

Educational-use disclaimer: this application is a research and learning tool. It is not SEBI-registered investment advice. The rewrite must preserve visible disclaimers and data-quality warnings.

## 1. Executive Summary

Stock Verifier is an Indian-market research toolkit with three major product lines:

| Product line | Current pages | Main purpose |
|---|---|---|
| Long-term fundamentals | `verify.php`, `index.php`, `stock-details.php`, `screener.php`, `fundamental-auto-screener.php`, `watchlist.php` | Fetch market/fundamental data, compute CFA-style valuation, MOS, gates, scorecards, and watchlist reviews. |
| Swing trading | `swing-trading.php`, `swing-auto-screener.php`, `swing-positions.php`, `strategies.php`, `morning-dashboard.php` | Scan universes with daily technical rules, regime filters, position tracking, and strategy jobs. |
| Intraday trading | `nifty-15m.php`, `intraday-app.php`, `nifty-intraday-backtest.php`, `nifty-positions.php` | Nifty/index/stock 5m and 15m radar, trade plan generation, preset comparison, and intraday position journal. |

The current PHP app mixes controller, view, and service logic inside page scripts. The domain engines are already mostly separated under `includes/`. A successful Node/React rewrite should:

1. Port domain engines first and protect exact numerical parity.
2. Replace PHP pages with React routes.
3. Replace page-level POST handlers with JSON APIs.
4. Replace file/SQLite state with Postgres plus Redis/job queue.
5. Preserve cache TTLs, warning labels, source metadata, and investment-readiness gates.
6. Treat all financial outputs as explainable research artifacts, not recommendations.

## 2. Current Runtime Model

The app currently runs as a PHP web root. Each `*.php` file is both route/controller and HTML renderer. Shared logic lives in `includes/`.

```text
Browser
  |
  | GET/POST page scripts
  v
PHP page controllers
  |
  | require_once includes/*
  v
Domain engines and services
  |
  | DataCache, JSON files, CSV files, Yahoo, Screener.in, NSE CSV
  v
Local data and external market data
```

Important current characteristics:

- Authentication is session-backed JSON user storage via `AuthManager`.
- Role permissions are enforced through `PageAuth` and `AdminAuth`.
- CSRF is HMAC-token based and required on mutating POSTs.
- Cache supports SQLite, MySQL, or file drivers via `DataCache`.
- Background jobs are stored in `DataCache` and spawned with PHP CLI scripts.
- Market data is fetched mainly from Yahoo Finance, Screener.in, NSE CSV files, and uploaded CSV overlays.
- Regression coverage is CLI-based, centered on `validate-logic.php` and `test-cross-page.php`.

## 3. Current Route Inventory and Target Mapping

### 3.1 Main HTML Pages

| Current PHP route | Current responsibility | Target React route | Target Node service/API |
|---|---|---|---|
| `help.php` | User guide hub | `/help` | Static content or CMS endpoint |
| `verify.php` | One-click CFA verification | `/research/verify` | `GET /api/stocks/:symbol/verify` |
| `index.php` | Full 8-phase verification form | `/research/full-verify` | `POST /api/verifications` |
| `stock-details.php` | Stock fetch, valuation, charts, details | `/research/stocks/:symbol` | `GET /api/stocks/:symbol/details` |
| `screener.php` | NSE screener, presets, universes, async jobs | `/research/screener` | `POST /api/screener/runs`, `GET /api/jobs/:id` |
| `fundamental-auto-screener.php` | LTG auto radar UI | `/research/ltg-auto` | `GET /api/fundamental-auto/state` |
| `watchlist.php` | Saved thesis/review dates | `/research/watchlist` | `/api/watchlist` |
| `strategies.php` | Hybrid strategy runner | `/trading/strategies` | `POST /api/strategies/runs` |
| `morning-dashboard.php` | Daily overview | `/dashboard/morning` | `GET /api/dashboard/morning` |
| `trading-presets.php` | Preset reference | `/trading/presets` | `GET /api/presets` |
| `swing-trading.php` | Swing symbol/universe/backtest UI | `/trading/swing` | `/api/swing/*` |
| `swing-auto-screener.php` | Auto swing radar | `/trading/swing-auto` | `GET /api/swing-auto/state` |
| `swing-positions.php` | Swing position tracker | `/trading/swing/positions` | `/api/swing/positions` |
| `nifty-15m.php` | Intraday radar | `/intraday/radar` | `GET /api/intraday/state` |
| `intraday-app.php` | PWA-style intraday app | `/intraday/app` | `GET /api/intraday/lite` |
| `nifty-intraday-backtest.php` | Intraday backtests and preset comparison | `/intraday/backtest` | `POST /api/intraday/backtests` |
| `nifty-positions.php` | Intraday position journal | `/intraday/positions` | `/api/intraday/positions` |
| `cache.php` | Cache, uploads, universes, admin | `/admin/cache` | `/api/admin/cache`, `/api/uploads`, `/api/universes` |
| `users.php` | User admin | `/admin/users` | `/api/admin/users` |
| `setup.php`, `login.php`, `logout.php` | Auth lifecycle | `/setup`, `/login` | `/api/auth/*` |
| `health.php` | Liveness/readiness JSON | Not needed in React | `GET /api/health` |

### 3.2 JSON and Worker Endpoints

| Current file | Purpose | Target endpoint |
|---|---|---|
| `fundamental-auto-api.php` | LTG auto state/start | `GET /api/fundamental-auto/state`, `POST /api/fundamental-auto/start` |
| `swing-auto-api.php` | Swing auto state, start, add/check position | `/api/swing-auto/*` |
| `swing-positions-api.php` | Swing open/closed position block | `GET /api/swing/positions/state` |
| `nifty-15m-api.php` | Intraday state/lite/position actions | `/api/intraday/*` |
| `nifty-positions-api.php` | Intraday positions state | `GET /api/intraday/positions/state` |
| `nifty-intraday-backtest-api.php` | Intraday backtest API | `POST /api/intraday/backtests` |
| `screener-job.php` | Screener job status | `GET /api/jobs/:id` |
| `strategy-job.php` | Strategy job status | `GET /api/jobs/:id` |
| `swing-chart-api.php` | Swing chart JSON | `GET /api/stocks/:symbol/swing-chart` |
| `swing-live-price.php` | Swing live price | `GET /api/stocks/:symbol/live-price` |
| `swing-positions-export.php` | CSV export | `GET /api/swing/positions/export.csv` |
| `nifty-positions-export.php` | CSV export | `GET /api/intraday/positions/export.csv` |

### 3.3 CLI and Background Workers

| Current worker/script | Current trigger | Target worker/job |
|---|---|---|
| `run-screener-job.php` | Spawned by `ScreenerJob` | `screener.scan` worker |
| `run-strategy-job.php` | Spawned by `StrategyJob` | `strategy.run` worker |
| `run-swing-scan-job.php` | Spawned by `SwingScanJob` | `swing.scan` worker |
| `run-daily-close-refresh-job.php` | Spawned by `DailyCloseRefreshJob` | `market.dailyCloseRefresh` worker |
| `run-annual-verify-job.php` | Spawned by `AnnualVerifyJob` | `research.annualVerify` worker |
| `import-index.php` | Manual/cron index import | `market.indexImport` worker |
| `refresh-daily-closes.php` | Manual refresh | `market.dailyCloseRefresh` worker |
| `validate-logic.php` | Regression tests | Jest/Vitest domain parity suite |
| `test-cross-page.php` | Cross-surface parity | API integration parity suite |
| `test-all-pages.php` | HTTP smoke | Playwright/API smoke suite |

## 4. Domain Architecture as Built

The current app is best understood as seven domains.

```text
Auth/Ops
  -> Page guards, roles, CSRF, health, logs

Market Data
  -> Yahoo, Screener.in, NSE CSV, uploaded overlays, cache

CFA Research
  -> Fetch -> normalize -> valuation -> verification gates -> memo

Screening
  -> Universe -> rows -> enrichment -> preset filters -> ranked output

Swing Trading
  -> Daily bars -> technical metrics -> entry/exit rules -> positions

Intraday Trading
  -> 5m/15m bars -> direction -> trade plan -> preset filters -> journal

Jobs and Automation
  -> Background scans, refreshes, auto dashboards, batch verify
```

### 4.1 Core Class Map

| Future Node module | Current PHP classes/functions |
|---|---|
| `auth` | `AuthManager`, `AdminAuth`, `PageAuth`, `SecurityHeaders` |
| `ops` | `HealthCheck`, `AppLog`, `ApiResponse`, `DataCache` |
| `market-data` | `StockDataFetcher`, `ScreenerInParser`, `TechnicalAnalysisHelper`, `SymbolResolver`, `ScreenerCompanyProfile` |
| `universes` | `UniverseRegistry`, `UniverseIds`, `IndexSymbolLoader`, `UniverseCacheInvalidator`, `ExchangeListLoader` |
| `overlays` | `PromoterHoldingLoader`, `PromoterPledgeLoader`, `SectorHints`, `SectorNormalizer`, `StockCacheOverlay`, `StockRowBuilder` |
| `valuation` | `CfaValuationEngine`, `MosHelper`, `FairPeCalculator`, `QuantScreenHelper`, `EpsModeHelper` |
| `verification` | `VerificationEngine`, `CfaAutoVerifier`, `AnnualReportLogic`, `CfaInvestmentMemo`, `ExecutiveSummary`, `VerificationResultCache`, `DataQualityGateHelper` |
| `screener` | `NseStockScreener`, `CfaStockAnalyzer`, `ScreenerInputResolver`, `ScreenerRunHelper`, `ScreenerTaPreset`, `LiveParityChecker` |
| `watchlist` | `WatchlistStore` |
| `strategy` | `StrategyRegistry`, `StrategyRunner`, `StrategyJob`, `TradingPreset` |
| `swing` | `SwingTradingRules`, `SwingTradingScanner`, `SwingTradingContext`, `SwingMarketRegime`, `SwingEntryScorer`, `SwingTradeRanker`, `SwingPortfolioRisk`, `SwingPositionStore`, `SwingPositionTracker`, `SwingTradePnl`, `SwingClosedTradeStats`, `SwingAutoScreener`, `SwingAutoDecision`, `SwingAutoBacktestTruth`, `SwingAutoIncrementalScan`, `SwingSamplePortfolio`, `SwingEtfUniverse`, `SwingGc9Dc9`, `SwingDynamicSignals`, `SwingScanJob` |
| `intraday` | `Nifty15mDirection`, `NiftyIntradayMtf`, `NiftyIntradayTradePlan`, `NiftyIntradayEntryFilter`, `NiftyIntradayExitProfile`, `NiftyIntradayBacktest`, `NiftyIntradaySessionClock`, `NiftyIntradaySessionRegime`, `NiftyIntradaySignalQuality`, `NiftyIntradayLivePlaybook`, `NiftyIntradayScalpSetup`, `NiftyIntradayIndex`, `IntradayInstrument`, `IntradayPwa`, `NiftyIntradayPositionStore`, `NiftyIntradayPositionTracker`, `NiftyIntradayPositionSource`, `NiftyIntradayClosedTradeStats`, `NiftyIntradayEma50Bias`, `NiftyIntradayGc9Dc9` |
| `ui-legacy` | `AppLayout`, `FormState`, `FormHelpers`, `screener_ui.php`, `data_quality_ui.php`, `price_freshness_ui.php`, `cfa_report.php`, `I18n`, `GateI18n`, `AppGuide` |

## 5. Financial Domain Logic

The financial engines are the most important part of the rewrite. UI parity is secondary to numerical and decision parity.

### 5.1 Market Data Normalization

`StockDataFetcher` is the current source of normalized stock data.

Current inputs:

- User query: symbol or company name.
- Yahoo Finance data: prices, ratios, quote summary, financial fields.
- Screener.in consolidated and standalone pages.
- Local overlays: sector hints, promoter holding, promoter pledge, exchange restrictions, index CSVs.
- Cache overlays from previous verify fetches.

Current output shape:

```ts
type StockFetchResult = {
  success: boolean;
  symbol: string;              // Usually NSE symbol with .NS from Yahoo
  company_name: string;
  sources: string[];
  data: StockFundamentalData;
  analyzer_input: Record<string, unknown>;
  verifier_input: Record<string, unknown>;
  from_cache: boolean;
  cached_until?: string;
  error?: string;
};
```

Migration rule: build one canonical `StockFundamentalData` DTO in TypeScript. All downstream engines should consume this DTO or a specific mapper from it.

### 5.2 CFA Valuation Engine

Current engine: `CfaValuationEngine`.

Primary output fields:

- `valuation_model`
- `quality_score`
- `quality_breakdown`
- `fair_pe`
- `dcf_value`
- `alt_value`
- `intrinsic`
- `mos`
- `mos_zone`
- `final_rating`
- `rating_tier`
- `key_risks`
- `moat_tier`
- `graham`
- `graham_credible`
- `altman_z`
- `z_score_source`
- `valuation_flags`

Current sector model selection:

| Sector key | Model |
|---|---|
| `fmcg`, `it`, `pharma`, `auto`, `defence`, `general` | DCF + Fair P/E + DDM if dividend applies |
| `banking`, `nbfc`, `insurance` | P/B |
| `metal`, `cement`, `telecom`, `infra`, `oil_gas` | EV/EBITDA |
| `utility`, `reit` | DDM + DCF |

Important formulas and rules:

```text
MOS = (intrinsic_value - current_price) / intrinsic_value * 100

Graham Number = sqrt(22.5 * EPS * Book Value Per Share)

Fair P/E = clamp(
  8
  + 0.4 * EPS CAGR 5Y
  + 0.1 * ROCE
  + moat premium
  + size premium
  - debt penalty,
  8,
  40
)
```

MOS rating bands:

| MOS | Rating |
|---:|---|
| `> 40%` | Strong Buy |
| `25% to 40%` | Buy |
| `10% to 25%` | Accumulate |
| `0% to 10%` | Hold |
| `< 0%` | Expensive |

Critical migration requirement: keep all valuation constants and clamp behavior in one TypeScript module with snapshot tests.

### 5.3 Quality Score

`CfaValuationEngine::qualityScore()` produces a 100-point quality score from:

- ROE
- ROCE
- Debt
- Piotroski F-Score
- Moat
- Management
- Cash flow
- Altman distress score where applicable

`CfaStockAnalyzer` also has a screener-oriented six-pillar composite:

| Pillar | Weight |
|---|---:|
| Profitability | 24% |
| Valuation | 22% |
| MOS | 18% |
| Growth | 18% |
| Quality | 12% |
| Yield | 6% |

The current display score prefers the engine quality score when available and falls back to the pillar composite. Preserve this dual-score behavior so existing screen results do not unexpectedly change.

### 5.4 Full Verification Engine

Current engine: `VerificationEngine`.

It runs all phases, builds a 56-point scorecard, scans red flags, computes position size, and builds investment-readiness metadata.

| Phase | Theme | Current examples |
|---|---|---|
| 0 | Investor foundation | Emergency fund, debt cleared, SIP habit, allocation, discipline |
| 1 | Business quality | Business model, revenue model, industry, moat, promoter pledge, audit |
| 2 | Financial statements | Revenue/PAT quality, margins, D/E, book value, working capital, FCF, CFO/PAT |
| 3 | Ratios | ROE, ROCE, D/E, interest coverage, PE/PB, growth, dividend |
| 4 | Valuation | DCF/Fair P/E/Graham/MOS, value-trap flags, growth sanity |
| 5 | Quant screens | Piotroski, Altman Z, DCF sanity |
| 6 | Sector checks | Banking, IT, pharma, auto, telecom, utility, REIT, oil/gas, metals, cement, etc. |
| 7 | Portfolio fit | Allocation, sector concentration, correlation, entry plan |
| 8 | Thesis | Business thesis, financial thesis, valuation thesis, invalidation triggers, review date |

Investment-ready logic is intentionally stricter than screening:

- Screening mode should never become fully investment-ready.
- Auto mode needs manual attestation.
- Extreme MOS values require manual verification.
- Phase 8 thesis completion matters.
- Red flags and low MOS/score block readiness.

Migration rule: split the engine into:

```text
verification/
  sanitizeVerificationInput.ts
  deriveMetrics.ts
  phases/
    phase0InvestorFoundation.ts
    phase1BusinessQuality.ts
    ...
  scorecard.ts
  redFlags.ts
  verdict.ts
  investmentReady.ts
```

### 5.5 Data Quality Gates

Current helper: `DataQualityGateHelper`.

These gates protect against false confidence from stale or proxy data. The React UI must show them prominently, not hide them in tooltips.

Key concepts:

- Cache freshness.
- Sector routing confidence.
- FCF proxy warnings.
- Altman source reliability.
- Graham credibility.
- Manual parity check for cross-page IV/MOS consistency.
- Extreme MOS warnings.

### 5.6 Screener Logic

Current engine: `NseStockScreener` + `CfaStockAnalyzer`.

High-level flow:

```text
Resolve universe
  -> load raw symbol rows
  -> preload verify/fetch caches
  -> prefetch TA charts if needed
  -> apply exchange restriction skips
  -> optional table prefilter
  -> enrich row for MOS
  -> apply CFA analyzer
  -> attach parity hints
  -> apply recommendation/min-score filters
  -> sort and summarize
```

Current preset categories:

- Quality/value/growth/defensive.
- Senior CFA screens.
- Deep value and MOS screens.
- Moat/monopoly screens.
- Technical-only and combined CFA+TA screens.
- LTG high-conviction screens.

Migration rule: presets should be database-seeded or versioned JSON config, while scoring functions remain code.

### 5.7 Technical Analysis Logic

Current engine: `TechnicalAnalysisHelper`.

Daily/swing metrics:

- RSI-14.
- SMA 9/20/50/200.
- EMA metrics.
- MACD 12/26/9.
- Bollinger Bands 20,2 and percent B.
- ATR-14 and ATR percent.
- 52-week range and date-derived green/red zones.
- Volume surge and average daily value.
- Moving-average crossovers including GC9/DC9 and 50/200 crosses.

These metrics are used for timing and trading, not as substitutes for CFA fundamental score.

### 5.8 Swing Trading Logic

Current engines:

- `SwingTradingRules`
- `SwingTradingScanner`
- `SwingMarketRegime`
- `SwingTradeRanker`
- `SwingPositionTracker`

Core ideas:

- Daily swing horizon is roughly 2 to 40 sessions.
- Rules are long-side oriented.
- Entry uses trend alignment, pullback, momentum, 52-week band, overextension, liquidity, EMA stack, price action, dynamic signals, GC9, regime, and charge-aware target edge.
- Exit uses stops, trailing stop, breakeven, partial target logic, time stop, SMA/EMA breaks, RSI/MACD, and price action.
- Position store tracks open/closed trades, entry price/date, shares, stop, target, highest price, trailed stop, source, and closure.

Migration rule: implement swing rules as pure functions first, then wrap with services.

### 5.9 Intraday Logic

Current engines:

- `Nifty15mDirection`
- `NiftyIntradayMtf`
- `NiftyIntradayTradePlan`
- `NiftyIntradayEntryFilter`
- `NiftyIntradayBacktest`
- `NiftyIntradayPositionStore`

Core concepts:

- Supported timeframes: 5m and 15m.
- Instruments include Nifty/indexes and resolved stock symbols.
- Direction combines EMA stack, RSI, GC9/DC9, recent candles, session change, session regime, MTF confluence, and setup quality.
- Trade plans include entry, stop, targets, trailing rules, invalidation, and chart levels.
- Entry presets are shared between live radar and backtest. This parity is critical.
- Position journal supports add/close/update, extremes, breakeven, source attribution, and closed stats.

Migration rule: live radar and backtest must import the same TypeScript entry-filter and exit-profile modules.

## 6. Data Sources and Integration Boundaries

| Source | Current use | Current cache bucket | Node service |
|---|---|---|---|
| Yahoo Finance quote/summary/chart | Price, ratios, OHLCV, intraday bars | `stock`, `yahoo`, `ta`, `http` | `YahooMarketDataProvider` |
| Screener.in company pages | ROCE, standalone/consolidated ratios, profile text | `screener`, `screener_table`, `screener_health` | `ScreenerInProvider` |
| NSE index CSVs | Nifty 50/100/250/500/smallcap symbols | `index_symbols` | `NseIndexProvider` |
| Uploaded All NSE CSV | Full market universe | file: `data/indices/ind_nse_equity_list.csv` | `UniverseImportService` |
| Uploaded promoter holding CSV | Verified promoter holding filter | file: `data/holding/holding.csv` | `HoldingImportService` |
| Uploaded pledge CSV | Phase 1.6 pledge | file: `data/pledge/*` | `PledgeImportService` |
| Manual ASM/GSM/T2T JSON | Restricted-list exclusion | file: `data/exchange/asm_gsm_manual.json` | `ExchangeRestrictionService` |
| Custom universes JSON | User-defined symbol lists | file: `data/custom_universes.json` | `UniverseService` |

Provider design in Node:

```ts
interface MarketDataProvider {
  fetchStock(symbol: string, options?: FetchOptions): Promise<StockFetchResult>;
  fetchDailyBars(symbol: string, range: string): Promise<BarSeries | null>;
  fetchIntradayBars(symbol: string, interval: "5m" | "15m"): Promise<BarSeries | null>;
}
```

Every provider response should carry:

- `source`.
- `fetchedAt`.
- `cachedUntil`.
- `sourceUrl` when allowed.
- `qualityFlags`.
- `rawAvailable` flag for audit/debug.

## 7. Current Storage and Target Database Model

### 7.1 Current Files and Stores

| Current path | Meaning | Target persistence |
|---|---|---|
| `data/cache/settings.json` | Cache driver settings | Environment/config table |
| `data/cache/market_data.sqlite` | SQLite cache | `cache_entries` or Redis plus Postgres snapshots |
| `data/cache/files/*` | File cache entries | Object store or Redis/Postgres |
| `data/auth/users.json` | Users | `users` table |
| `data/auth/audit.log` | Auth audit | `audit_logs` table |
| `data/watchlist.json` | Watchlist | `watchlist_entries` table |
| `data/custom_universes.json` | Custom universes | `universes`, `universe_symbols` |
| `data/swing_positions.json` | Swing positions | `swing_positions` |
| `data/nifty_intraday_positions.json` | Intraday positions | `intraday_positions` |
| `data/indices/*.csv` | Uploaded/bundled universes | `uploaded_files`, `universe_symbols` |
| `data/holding/*` | Promoter holding overlays | `promoter_holdings` |
| `data/pledge/*` | Pledge overlays | `promoter_pledges` |
| `data/exchange/asm_gsm_manual.json` | Restricted symbols | `exchange_restrictions` |
| `data/logs/app.log` | App logs | structured logger sink |

### 7.2 Recommended Database Tables

Use a relational database for durable financial state. Keep Redis for short-lived cache, rate limits, and job progress.

```sql
users(
  id, username, display_name, role, password_hash,
  active, created_at, updated_at, last_login_at
)

audit_logs(
  id, user_id, action, ip, user_agent, context_json, created_at
)

instruments(
  id, symbol, yahoo_symbol, exchange, name, sector_key,
  industry, active, created_at, updated_at
)

market_snapshots(
  id, instrument_id, source, payload_json, fetched_at,
  cached_until, quality_flags_json
)

stock_fundamentals(
  id, instrument_id, as_of_date, price, market_cap_cr,
  pe, pb, eps, book_value, roe, roce, debt_to_equity,
  revenue_growth_3yr, eps_growth, dividend_yield,
  promoter_holding_pct, pledge_pct, payload_json, source_meta_json
)

verification_runs(
  id, instrument_id, mode, input_json, metrics_json,
  phases_json, scorecard_json, verdict_json,
  investment_ready_json, memo_json, created_by, created_at
)

screener_runs(
  id, universe_id, preset_key, filters_json, sort_by,
  status, scanned_count, passed_count, summary_json,
  started_at, completed_at, created_by
)

screener_rows(
  id, run_id, instrument_id, rank, pass,
  score, grade, mos, intrinsic_value, fair_pe,
  recommendation_tier, row_json
)

universes(
  id, key, label, type, source, updated_at, created_by
)

universe_symbols(
  id, universe_id, instrument_id, sort_order, added_at
)

watchlist_entries(
  id, user_id, instrument_id, sector_key, review_date,
  thesis_business, thesis_financials, thesis_valuation,
  invalidation_1, invalidation_2, last_verified_at,
  last_score, last_mos, last_verdict, updated_at
)

swing_positions(
  id, user_id, instrument_id, status, entry_price, entry_date,
  shares, stop_loss, profit_target, highest_since_entry,
  trailed_stop_loss, source, notes, closed_at,
  closed_price, closed_reason, created_at, updated_at
)

intraday_positions(
  id, user_id, instrument_id, side, timeframe, status,
  entry_price, entry_time, stop_loss, target_t1, target_t2,
  target_t3, quantity, source, preset_id, notes,
  high_since_entry, low_since_entry, breakeven_stop,
  closed_at, closed_price, closed_reason, created_at, updated_at
)

jobs(
  id, type, status, input_json, progress_json,
  result_json, error, created_by, created_at, updated_at
)

uploaded_files(
  id, kind, original_name, stored_path, checksum,
  imported_count, meta_json, uploaded_by, uploaded_at
)

cache_entries(
  id, source, cache_key, payload_json, expires_at, created_at, updated_at
)
```

## 8. Target Node Architecture

Recommended logical shape:

```text
repo/
  apps/
    api/                 # Node HTTP API
    web/                 # React app
    workers/             # Queue processors
  packages/
    domain/              # Pure financial and trading engines
    market-data/         # Yahoo, Screener, NSE providers
    db/                  # schema, migrations, repositories
    contracts/           # shared TypeScript DTOs and schemas
    test-fixtures/       # golden parity fixtures
```

### 8.1 API Layers

```text
HTTP controller
  -> request validation
  -> auth/permission middleware
  -> service orchestration
  -> domain engine
  -> repository/cache/provider
  -> response DTO
```

Do not let controllers contain valuation or trading formulas. Controllers should validate input and call services only.

### 8.2 Service Boundaries

| Service | Responsibility |
|---|---|
| `AuthService` | Login, logout, session/JWT, roles, permissions |
| `StockService` | Resolve symbol, fetch fundamentals, stock details |
| `ValuationService` | CFA valuation, MOS, quality, data-quality flags |
| `VerificationService` | Full 8-phase verification and memo |
| `ScreenerService` | Universe scans, presets, ranked rows |
| `UniverseService` | Built-in/custom/uploaded universes |
| `MarketDataService` | Yahoo/Screener/NSE orchestration and caching |
| `TechnicalAnalysisService` | Daily/intraday metrics and chart payloads |
| `SwingService` | Swing scan, entry/exit, positions |
| `IntradayService` | Radar, trade plans, backtests, positions |
| `StrategyService` | Hybrid strategy execution |
| `JobService` | Create, poll, cancel, and store background jobs |
| `AdminService` | Cache stats, purges, uploads, settings |
| `HealthService` | Liveness/readiness |

### 8.3 Job Queue

Replace PHP `exec(... &)` workers with a queue.

Job types:

- `screener.scan`
- `strategy.run`
- `swing.scan`
- `market.dailyCloseRefresh`
- `research.annualVerify`
- `fundamentalAuto.scan`
- `swingAuto.scan`
- `index.import`

Job state should include:

```ts
type JobState<TInput = unknown, TResult = unknown> = {
  id: string;
  type: string;
  status: "pending" | "running" | "done" | "failed";
  input: TInput;
  progress: {
    phase?: string;
    total?: number;
    processed?: number;
    passed?: number;
    failed?: number;
  };
  result?: TResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
};
```

## 9. Proposed API Contracts

Use typed request/response schemas and keep API responses stable.

### 9.1 Standard Response Shapes

```ts
type ApiSuccess<T> = {
  ok: true;
  data: T;
  requestId: string;
};

type ApiError = {
  ok: false;
  error: string;
  code?: string;
  requestId: string;
};
```

### 9.2 Research APIs

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/stocks/:symbol/details` | Fetch normalized data, valuation, TA summary, source metadata |
| `GET` | `/api/stocks/:symbol/verify` | One-click CFA auto verification |
| `POST` | `/api/verifications` | Full manual/auto verification run |
| `GET` | `/api/verifications/:id` | Historical verification run |
| `GET` | `/api/stocks/:symbol/parity` | Verify/screener/detail parity check |
| `GET` | `/api/watchlist` | Watchlist rows |
| `POST` | `/api/watchlist` | Upsert watchlist entry |
| `DELETE` | `/api/watchlist/:symbol` | Remove watchlist entry |

Example `GET /api/stocks/TCS/verify` response:

```json
{
  "ok": true,
  "data": {
    "symbol": "TCS.NS",
    "companyName": "Tata Consultancy Services",
    "screeningMode": true,
    "fetch": {
      "fromCache": true,
      "sources": ["Yahoo Finance", "Screener.in consolidated"]
    },
    "result": {
      "metrics": {
        "intrinsicValue": 0,
        "marginOfSafety": 0,
        "qualityScore": 0,
        "valuationModel": "dcf_fairpe_ddm"
      },
      "phases": [],
      "scorecard": {},
      "verdict": {},
      "investmentReady": {}
    },
    "memo": {},
    "assumptions": []
  },
  "requestId": "..."
}
```

### 9.3 Screener APIs

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/screener/presets` | Preset config |
| `POST` | `/api/screener/runs` | Start sync or async run |
| `GET` | `/api/screener/runs/:id` | Run result |
| `GET` | `/api/screener/runs/:id/export.csv` | CSV export |
| `GET` | `/api/universes` | Built-in/custom universe options |
| `POST` | `/api/universes` | Create custom universe |
| `PUT` | `/api/universes/:id` | Update custom universe |
| `DELETE` | `/api/universes/:id` | Delete custom universe |

Request:

```ts
type ScreenerRunRequest = {
  universe: string;
  preset: string;
  filters?: Record<string, unknown>;
  sortBy?: string;
  maxScan?: number;
  recommendationFilter?: string;
  excludeRestricted?: boolean;
  async?: boolean;
};
```

Response should either return a completed run or a `jobId`.

### 9.4 Swing APIs

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/swing/state` | Symbol/universe mode state |
| `POST` | `/api/swing/scans` | Run or enqueue swing scan |
| `GET` | `/api/swing-auto/state` | Auto snapshot and positions |
| `POST` | `/api/swing-auto/start` | Start auto scan |
| `GET` | `/api/swing/positions` | Positions |
| `POST` | `/api/swing/positions` | Add position |
| `PATCH` | `/api/swing/positions/:id` | Update position |
| `POST` | `/api/swing/positions/:id/close` | Close position |
| `DELETE` | `/api/swing/positions/:id` | Remove position |

### 9.5 Intraday APIs

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/intraday/state?index=nifty50&tf=5m` | Full radar state |
| `GET` | `/api/intraday/lite` | PWA-lite state |
| `POST` | `/api/intraday/positions` | Add position |
| `POST` | `/api/intraday/positions/:id/close` | Close position |
| `GET` | `/api/intraday/positions` | Position state |
| `POST` | `/api/intraday/backtests` | Run backtest/compare |
| `GET` | `/api/intraday/presets` | Entry and exit presets |

### 9.6 Admin APIs

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness |
| `GET` | `/api/health?detailed=1` | Readiness detail |
| `GET` | `/api/admin/cache/stats` | Cache stats |
| `POST` | `/api/admin/cache/purge` | Purge cache |
| `POST` | `/api/uploads/index-csv` | Index CSV import |
| `POST` | `/api/uploads/all-nse-csv` | All NSE import |
| `POST` | `/api/uploads/holding-csv` | Promoter holding import |
| `POST` | `/api/uploads/pledge-csv` | Pledge import |
| `GET` | `/api/admin/users` | List users |
| `POST` | `/api/admin/users` | Create user |
| `PATCH` | `/api/admin/users/:id` | Update user |

## 10. React Application Architecture

### 10.1 Routes

```text
/login
/setup
/help
/dashboard/morning

/research/verify
/research/full-verify
/research/stocks/:symbol
/research/screener
/research/ltg-auto
/research/watchlist

/trading/presets
/trading/strategies
/trading/swing
/trading/swing-auto
/trading/swing/positions

/intraday/radar
/intraday/app
/intraday/backtest
/intraday/positions

/admin/cache
/admin/users
```

### 10.2 Suggested Frontend Modules

```text
src/
  app/
    router.tsx
    providers.tsx
    layout/
  features/
    auth/
    research/
      verify/
      fullVerify/
      stockDetails/
      screener/
      watchlist/
    trading/
      swing/
      strategies/
    intraday/
      radar/
      backtest/
      positions/
    admin/
  shared/
    api/
    components/
    charts/
    forms/
    formatters/
    i18n/
    permissions/
```

### 10.3 State Management

Use server-state caching for API data and plain React state for form editing.

Recommended patterns:

- Query keys include symbol, universe, preset, timeframe, and filters.
- Poll job endpoints while status is `pending` or `running`.
- Keep full verification form state client-side until submit.
- Persist table filters in URL query parameters where possible.
- Keep numeric formatting separate from raw API values.
- Never recompute financial metrics in React unless it is purely cosmetic.

### 10.4 High-Value React Components

| Component | Purpose |
|---|---|
| `AppShell` | Navigation, user menu, cache/job status hints |
| `DisclaimerBanner` | Educational/non-advisory warning |
| `SourceBadgeList` | Yahoo/Screener/NSE/uploaded source metadata |
| `DataQualityPanel` | D-gates, freshness, proxy warnings |
| `ValuationSummary` | IV, MOS, fair P/E, model, rating |
| `PhaseScorecard` | Verification phases and gate statuses |
| `InvestmentReadyBadge` | Strict readiness state |
| `ScreenerFilterPanel` | Presets, universe, filters, TA controls |
| `ScreenerResultsTable` | Ranked results with expandable row detail |
| `JobProgressBanner` | Async run progress |
| `ChartPanel` | Lightweight charts for daily/intraday bars |
| `SwingSignalCard` | Entry/exit verdict and rules |
| `PositionTable` | Swing/intraday open and closed positions |
| `BacktestMatrix` | Preset/exit comparison |

## 11. Security and Permissions

Current roles:

| Role | Meaning |
|---|---|
| Admin | Full access, cache/uploads, universes, users |
| Analyst | View app, run screeners, refresh data, run parity |
| Viewer | Read-only |

Current permissions:

- `view_app`
- `run_screener`
- `run_parity`
- `refresh_data`
- `manage_cache`
- `manage_universes`
- `manage_users`

Target middleware:

```text
authenticate()
  -> attach current user

authorize(permission)
  -> check role permission map

csrf() or same-site session protection
  -> required for cookie-auth mutating requests

rateLimit(bucket)
  -> per user and per IP

requestId()
  -> trace every response and log row
```

Security must preserve:

- Password hashing.
- Session or token invalidation on logout.
- Role-based navigation hiding.
- CSRF protection for mutating actions.
- Rate limits for live data and job-start endpoints.
- Sanitized production API errors.
- Security headers.
- Audit trail for login/user/admin actions.

## 12. Caching Strategy

Current `DataCache::SOURCE_TTL` should become explicit cache policy.

| Source | Current TTL | Target use |
|---|---:|---|
| `universe` | 24h | Universe snapshots |
| `index_symbols` | 30d | Nifty CSV imports |
| `screener_table` | 24h | Screener.in bulk table |
| `screener_job` | 1h | Job state/result |
| `strategy_job` | 1h | Job state/result |
| `swing_scan_job` | 1h | Job state/result |
| `swing_auto` | 2h | Auto swing snapshot |
| `fundamental_auto` | 2h | LTG auto snapshot |
| `screener_row` | 1h | Per-symbol analyzed row |
| `daily_close_job` | 24h | Job state/result |
| `ta` | 24h | OHLCV/TA chart cache |
| `http` | 1h | Raw HTTP responses |
| `stock` | 7d | Stock fetch result |
| `stock_verify` | 7d | CFA verify result |
| `stock_verify_job` | 24h | Batch verify job |
| `yahoo` | 7d | Yahoo summary |
| `screener` | 7d | Screener page parse |
| `stock_alias` | 7d | Query alias mapping |

Node approach:

- Redis for rate limits, job progress, and hot short-lived API cache.
- Postgres for durable snapshots and completed research artifacts.
- Optional object storage for raw HTML/JSON payloads if audit retention is required.
- Cache keys must include source, symbol, interval/range, and versioned parser/schema key.

## 13. Migration Plan

### Phase 0 - Freeze Behavior

1. Run `php validate-logic.php`.
2. Run `php test-cross-page.php TCS INFY HDFCBANK`.
3. Export representative JSON fixtures for:
   - `StockDataFetcher::fetch`.
   - `CfaValuationEngine::analyze`.
   - `VerificationEngine::run`.
   - `NseStockScreener::run`.
   - `TechnicalAnalysisHelper` metrics.
   - Swing and intraday example outputs.
4. Record current score/MOS/IV values as golden baselines.

### Phase 1 - Port Pure Domain Logic

Port first:

- `MosHelper`.
- `FairPeCalculator`.
- `QuantScreenHelper`.
- `CfaValuationEngine`.
- `CfaStockAnalyzer`.
- `VerificationEngine` phase functions.
- `TechnicalAnalysisHelper` indicator formulas.
- `SwingTradingRules`.
- `NiftyIntradayEntryFilter`.
- `NiftyIntradayTradePlan`.

Do not start with React. The riskiest asset is the financial engine.

### Phase 2 - Build Data Providers and Repositories

1. Implement Yahoo provider.
2. Implement Screener.in provider.
3. Implement NSE CSV import.
4. Implement uploaded overlays.
5. Implement cache policy.
6. Implement Postgres repositories.

### Phase 3 - Build Node APIs

Start with APIs that can be tested without UI:

1. `/api/health`.
2. `/api/stocks/:symbol/details`.
3. `/api/stocks/:symbol/verify`.
4. `/api/screener/runs`.
5. `/api/jobs/:id`.
6. `/api/universes`.
7. `/api/watchlist`.

Then add swing and intraday APIs.

### Phase 4 - Build React Screens

Recommended order:

1. Auth shell.
2. Stock details.
3. CFA verify.
4. Screener.
5. Watchlist.
6. Swing positions.
7. Swing scanner.
8. Intraday radar.
9. Backtest.
10. Admin cache/users.

### Phase 5 - Run Parallel Production

For each symbol/run:

```text
PHP output
  vs
Node output
  -> compare IV, MOS, score, rating, phase score, data quality, recommendations
```

Cut over only when:

- IV delta is within agreed tolerance.
- MOS delta is within agreed tolerance.
- Ratings and recommendation tiers match or have approved reason codes.
- Source/freshness warnings are preserved.
- Job progress and exports work.

## 14. Testing Strategy

### 14.1 Domain Unit Tests

Port every important assertion from `validate-logic.php`.

Must-cover areas:

- MOS formula.
- Sector model routing.
- Fair P/E formula.
- Graham credibility.
- Altman applicability and sanity caps.
- Data-quality gates.
- Investment-ready gate.
- Screener presets and filters.
- Moat/monopoly screens.
- CSV parser and upload validation.
- Technical indicators.
- Swing entry/exit.
- Intraday presets and trade plans.

### 14.2 Parity Tests

Build a TypeScript equivalent of `test-cross-page.php`.

For each symbol:

- `details` IV/MOS equals `verify` IV/MOS within tolerance.
- `screener` IV/MOS equals `verify` within tolerance after cache overlay.
- `MosHelper` path equals screener path.
- TA details equal screener TA path.
- Promoter holding overlay matches fetch and screener.

### 14.3 API Tests

Test:

- Auth required.
- Permission denied.
- CSRF or same-site protections.
- Job creation/status.
- CSV imports.
- Error sanitization in production mode.
- Rate limits.

### 14.4 React Tests

Use component tests for:

- Data-quality panels.
- Screener filter serialization.
- Verification phase rendering.
- Job polling states.
- Position add/close forms.

Use end-to-end tests for:

- Login -> verify symbol -> save watchlist.
- Run screener -> poll job -> export CSV.
- Start swing scan -> add position.
- Intraday radar -> add/close position.

## 15. Financial Product Controls

These controls should remain visible in the Node/React version:

1. Educational/non-advisory disclaimer on research and trading pages.
2. Source metadata for every automated number.
3. Explicit warning for proxy FCF, estimated EBITDA, unreliable Altman, stale cache, and extreme MOS.
4. Screening mode cannot be treated as investment-ready.
5. Manual attestation required for auto-generated investment readiness.
6. Phase 8 thesis and invalidation triggers must not be skipped for long-term investing.
7. Exchange restrictions such as ASM/GSM/T2T must remain visible.
8. Uploaded promoter holding data must be distinguished from proxy/source-inferred holding.
9. Intraday and swing backtests must state assumptions around fills, slippage, charges, and simulation limits.

## 16. Known Migration Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Financial formula drift | Small numeric changes alter ratings and trust | Golden fixtures and parity tests before UI work |
| Dual score confusion | Screener has engine quality and pillar composite | Preserve both fields and label score source |
| Cache freshness differences | Fresh/stale values can change IV/MOS | Port TTL policy and cache metadata exactly |
| Screener.in parser changes | HTML parsing is fragile | Provider health metrics and fallback messaging |
| Yahoo rate limits | Large scans can fail or slow down | Queue, cache, backoff, concurrency limits |
| All NSE scan scale | Thousands of symbols can time out | Queue with progress and hard caps |
| Auth regression | Admin/cache/upload surfaces are sensitive | Middleware tests and role matrix |
| UI hides warnings | Cleaner UI can accidentally remove risk context | Data-quality panel is required on result surfaces |
| Live/backtest mismatch | Intraday presets must match both paths | Shared preset module, no duplicated frontend logic |

## 17. Implementation Checklist for Developers

Use this as the conversion backlog.

- [ ] Create TypeScript DTOs for stock fetch, valuation, verification, screener row, TA metrics, positions, and jobs.
- [ ] Port pure financial helpers and lock with golden tests.
- [ ] Port full verification phases and investment-ready logic.
- [ ] Port screener presets and analyzer filters.
- [ ] Port technical indicators and chart parsers.
- [ ] Port swing and intraday rule engines.
- [ ] Build Postgres schema and migrations.
- [ ] Implement Redis/cache abstraction with source TTLs.
- [ ] Implement Yahoo, Screener.in, NSE, and upload providers.
- [ ] Implement auth, roles, CSRF/session protection, and rate limits.
- [ ] Implement job queue and workers.
- [ ] Build research APIs.
- [ ] Build screener/universe APIs.
- [ ] Build swing APIs.
- [ ] Build intraday APIs.
- [ ] Build admin APIs.
- [ ] Build React app shell and route guards.
- [ ] Build research screens.
- [ ] Build screener with async job polling.
- [ ] Build swing and intraday screens.
- [ ] Build admin/cache/upload/user screens.
- [ ] Run PHP-vs-Node parity suite.
- [ ] Run E2E workflow suite.
- [ ] Run a parallel period before retiring PHP.

## 18. Recommended Acceptance Criteria

The Node/React rewrite is acceptable when:

1. All ported golden tests pass.
2. `TCS`, `INFY`, `HDFCBANK`, `ONGC`, and one small-cap fixture show explainable parity with PHP.
3. Screener run results match PHP ordering within approved tolerances for the same cache snapshot.
4. Full verification scorecard, phase statuses, and investment-ready output match PHP for fixtures.
5. Swing and intraday live/backtest logic share the same preset modules.
6. All admin mutations require permission and anti-CSRF or equivalent same-site protection.
7. Cache/source/freshness metadata appears in every result where the PHP app shows it.
8. CSV upload workflows update universes/holdings/restrictions and invalidate related caches.
9. Job polling works for large screener, swing, strategy, and refresh jobs.
10. React pages do not compute financial decisions client-side.

## 19. Architect Notes

The current PHP codebase is not just a website. It is a compact research platform with financial engines, source overlays, data-quality controls, and trading rule systems. The rewrite should avoid the common trap of rebuilding screens first and discovering later that numbers moved.

The safest path is:

```text
Port formulas -> prove parity -> expose APIs -> build React -> cut over gradually
```

For CFA-grade credibility, every final output should answer four questions:

1. What data produced this result?
2. How fresh and reliable is the data?
3. Which model or rule produced the number?
4. What would make the conclusion invalid?

If the Node/React version preserves those four answers, developers will have modernized the architecture without diluting the investment discipline of the app.
