# High Accuracy Architecture & CFA Calculation Rules

> Educational research tool only. This system supports investment research and decision discipline; it is not SEBI-registered investment advice.

## Purpose

This document is the operating standard for building an ultra-modern, high-accuracy Script Screener app. It defines how data should flow, where each value should come from, how calculations should be validated, and how the UI should disclose uncertainty.

## Architecture Principles

| Rule | Standard |
|------|----------|
| Source of truth | PostgreSQL stores durable/reference/user data. Redis stores only derivable hot cache. |
| Calculation ownership | CFA and trading calculations live in `packages/*`, not React pages. |
| Explicit freshness | Page loads may use cache. User-triggered refresh must bypass cache and replace stale cache only with valid data. |
| No silent zeroes | Missing fundamentals must be marked limited/estimated; zero is valid only when the source truly reports zero. |
| Cross-page parity | Details, Verify, Full Verify, Screener, Watchlist, and Swing must use the same normalized metrics where possible. |
| Data quality first | Valuation is shown with source, cache, and data-quality labels before decision actions. |

## Distribution Architecture

```text
React SPA
  -> Fastify API
      -> @sv/data-adapters
          -> Yahoo Finance, Screener.in, NSE files
          -> Redis hot cache
          -> PostgreSQL reference overlays
      -> @sv/core
          -> CFA valuation, MOS, scorecard, memo logic
      -> @sv/swing / @sv/intraday
          -> TA, swing gates, intraday state
      -> BullMQ worker
          -> scheduled scans, daily sync, auto-radar
```

### Package Boundaries

| Layer | Owns | Must not own |
|-------|------|--------------|
| `apps/web` | Rendering, state, user actions, warnings | Valuation formulas, cache policy, data source priority |
| `apps/api` | Auth, routes, orchestration, response shape | Low-level source parsing or formula duplication |
| `@sv/data-adapters` | External fetch, normalization, cache hydrate/evict | UI formatting |
| `@sv/core` | CFA formulas, scorecards, memo, investment gates | HTTP, Redis, DB |
| `@sv/cache` | Redis connection and safe cache helpers | Business logic |
| `@sv/db` | Durable models and Prisma | Redis-like transient state |

## Stock Fundamentals Pipeline

```text
symbol
  -> normalize symbol
  -> Redis sv:stock:{SYMBOL}
      -> accept only if core fundamentals are usable
  -> parallel fetch:
      -> Yahoo quoteSummary/chart price
      -> Screener ratios
      -> Screener annual financials
  -> merge:
      -> price and 52w range from Yahoo/chart
      -> PE, ROE, ROCE, market cap from Screener ratios when available
      -> EPS, CFO, FCF, debt, cash, margins, ROE/ROCE from Screener annual
      -> promoter holdings from uploaded CSV/PostgreSQL overlay
  -> enrich:
      -> book value from equity + market cap + price when missing
      -> P/B from price/book
      -> P/E from price/EPS
      -> capex proxy = CFO - FCF
  -> cache only if core CFA fields are complete
  -> API summary with data_quality
```

### Core Fundamentals Gate

A stock summary should be considered reported-quality only when these fields are positive:

| Field | Reason |
|-------|--------|
| `price` | Required for all valuation and MOS |
| `market_cap_cr` | Required for per-share conversions and EV logic |
| `pe` | Required for quick relative valuation |
| `eps` | Required for fair P/E, Graham, DCF proxy |
| `roe` | Required for quality, P/B, moat/return checks |
| `roce` | Required for capital efficiency and moat checks |

If these are missing, the API should return `data_quality.level = limited` or `estimated`, not silently display zero-filled fundamentals.

## Cache Policy

| Prefix | Purpose | TTL | Clear rule |
|--------|---------|-----|------------|
| `sv:stock` | Enriched stock fundamentals | 7d | Clear after source/parsing/fundamental merge changes |
| `sv:verify` | Cached verify result | 7d | Clear after valuation-engine changes |
| `sv:yahoo` | Raw Yahoo quote/chart payloads | 7d | Clear when raw price/source payload stale |
| `sv:screener:table` | Screener ratios/profile/annual tables | 24h | Clear when Screener parser changes |
| `sv:screener:row` | Per-preset analyzed screener row | 1h | Clear after screener scoring/filter changes |
| `sv:ta` | Daily/intraday chart and TA cache | 24h / session | Clear after chart/TA rule changes |
| `sv:universe`, `sv:index` | Redis mirrors of PostgreSQL/index data | 24h / 30d | Prefer index sync before manual clear |
| `sv:regime`, `sv:swing:auto` | Market regime and auto-radar snapshot | 15m / 2h | Clear only when timing state is stale |
| `sv:morning` | Morning bundle and ETF panel | 1m / 10m | Refresh from Morning routine actions |
| `sv:job:progress`, `sv:worker:heartbeat`, `sv:ratelimit` | Operational state | short/varies | Protected; do not clear from UI |

Single-symbol refresh must clear exact symbol keys plus scoped variants such as
`sv:screener:row:*:{SYMBOL}`, `sv:ta:bars:{SYMBOL}*`, `sv:ta:bars:1h:{SYMBOL}*`,
and `sv:ta:intraday:{SYMBOL}:*`.

## CFA Valuation Rules

### Normalization

| Metric | Rule |
|--------|------|
| EPS | Use reported EPS; derive from `price / PE` only if EPS is missing and PE/price are valid. |
| Book value | Use reported book value; derive from equity and market cap when possible; otherwise derive from EPS/ROE as a last resort. |
| ROCE | Use Screener ratios or annual statement calculation. Do **not** estimate ROCE from ROE; missing ROCE must remain missing/limited. |
| Revenue growth | Prefer 3-year CAGR when available; otherwise latest sales YoY; otherwise EPS growth. |
| Debt/equity | Normalize percentage-like values above 5 by dividing by 100. |
| Sector | Normalize source sector/industry into stable model keys (`it`, `banking`, `nbfc`, `fmcg`, etc.). |

### Score Contract

| Surface | Score meaning |
|---------|---------------|
| Screener / Stock Details quick valuation | `quality_score` is a 0–100 CFA quality proxy. Any displayed `/56` quick score is derived metadata only, not the Full Verify scorecard. |
| CFA Verify | Screening memo; recommendation is provisional and must disclose screening mode. |
| Full Verify | Authoritative 0–56 phase scorecard with red-flag gates, personal-finance gates, thesis, and investment-ready decision. |

### Intrinsic Value Models

| Sector/model | Primary method | Notes |
|--------------|----------------|-------|
| IT, FMCG, pharma, auto, defence, general | DCF + Fair P/E, optional DDM | Uses normalized EPS/FCF and quality-adjusted fair PE. |
| Banking, NBFC, insurance | P/B | EPS-only models can distort financials; book/ROE is primary. |
| Metals, cement, telecom, infrastructure, oil & gas | EV/EBITDA | Better for cyclical/capital-intensive sectors. |
| Utility, REIT/InvIT | DDM + DCF | Dividend yield and cash-flow stability matter more. |

### MOS Formula

```text
MOS % = (Intrinsic Value - Current Price) / Intrinsic Value * 100
```

Rules:

- If intrinsic value or price is unavailable, MOS is `null`.
- MOS above absolute 50% is flagged as extreme for manual review.
- Final rating must be interpreted with data quality and valuation flags.

### Rating Bands

| MOS | Rating |
|-----|--------|
| `> 40%` | Strong Buy |
| `25% to 40%` | Buy |
| `10% to 25%` | Accumulate |
| `0% to 10%` | Hold |
| `< 0%` | Expensive |
| Missing | Insufficient Data |

## Data Quality Labels

| Level | Meaning | UI action |
|-------|---------|-----------|
| `reported` | Core valuation inputs populated from live/cached market and fundamental sources | Normal display |
| `limited` | Core fields missing or only partial live source available | Show warning; valuation provisional |
| `estimated` | Fallback/sample/proxy inputs used | Show warning; require Full Verify before sizing |

## Cross-Page Accuracy Contract

| Surface | Must use |
|---------|----------|
| Stock Details | `getStockSummary()` from enriched `resolveStockMetrics()`; quick valuation derives from the same displayed metrics |
| Quick Verify | Same normalized metrics and engine assumptions as Details where possible |
| Full Verify | `fetchVerifierData()` from `resolveStockMetrics()` + annual data + manual inputs |
| Screener | `screenStock()` from `resolveStockMetrics()`; row cache must not outlive source truth |
| Watchlist | Last verified MOS/score plus explicit timestamp/source |
| Swing/Auto Radar | TA gates remain timing-only; they must not alter CFA valuation |

## Operational Checklist

Before trusting a page for decision-making:

1. Confirm `data_quality` is `reported`, or read the limited/estimated warning.
2. Confirm source list includes more than price-only Yahoo data for fundamental-heavy decisions.
3. Use **Clear cache & reload** after parser, valuation, or source-priority changes.
4. Run Full Verify before position sizing.
5. Treat TA and Swing phases as timing context, not valuation overrides.
6. For extreme MOS or very high intrinsic value, inspect valuation flags and annual inputs.

## Engineering Verification Checklist

Run these after data/valuation changes:

```bash
pnpm --filter @sv/core run typecheck
pnpm --filter @sv/data-adapters run typecheck
pnpm --filter @sv/api run typecheck
pnpm --filter @sv/web run typecheck
pnpm --filter @sv/data-adapters exec vitest run src/screener-annual.test.ts
```

Add or update tests when changing:

| Change area | Required coverage |
|-------------|-------------------|
| Screener parsing | HTML fixture with expected ratios, annual fields, cash flow, debt/cash |
| Metric merge | Price-only Yahoo + Screener annual fallback case |
| CFA model | Sector-specific intrinsic value and MOS expectations |
| Cache policy | Incomplete cache rejected; complete enriched cache accepted |
| UI display | Missing values show warning, not silent zeroes |

## Current Known Risks

| Risk | Mitigation |
|------|------------|
| External sources can block or change HTML | Parser tests, data quality warnings, explicit refresh |
| Cached stale zero-filled fundamentals | Reject incomplete `sv:stock`; clear and reload via Admin/Details |
| Verify and Details valuation drift | IV drift warning and shared normalized metric path |
| Sector misclassification | Sector hints and normalized sector mapping |
| Estimated DCF/EBITDA proxies | Valuation flags (`dcf_fcf_proxy`, `ebitda_estimated`) |

