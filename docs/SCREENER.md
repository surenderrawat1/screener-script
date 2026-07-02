# CFA Screener — Architecture & Speed Plan

The **CFA Screener** filters NSE universes using live fundamentals (Yahoo + Screener.in), CFA valuation (`CfaValuationEngine`), and MOS/recommendation tiers — with sync or background execution for large scans.

This document maps **PHP `screener.php`** to **Script Screener** architecture, explains performance characteristics, and defines the parity and speed roadmap.

> Educational research only — not investment advice.

---

## Table of contents

1. [What it does](#what-it-does)
2. [PHP vs Script Screener](#php-vs-script-screener)
3. [Why the new architecture is faster (at scale)](#why-the-new-architecture-is-faster-at-scale)
4. [System architecture](#system-architecture)
5. [Data flow](#data-flow)
6. [Presets & filters](#presets--filters)
7. [Universe resolution](#universe-resolution)
8. [Background jobs](#background-jobs)
9. [Cache layers](#cache-layers)
10. [API mapping (PHP → v2)](#api-mapping-php--v2)
11. [UI surfaces](#ui-surfaces)
12. [Parity matrix](#parity-matrix)
13. [Speed optimization plan](#speed-optimization-plan)
14. [File reference](#file-reference)

---

## What it does

| Capability | Description |
|------------|-------------|
| **Universe scan** | nifty50, nifty100, nifty250, nifty500, smallcap250, total_nse, custom |
| **CFA valuation** | DCF, fair P/E, Graham floor, MOS %, quality score |
| **Presets** | Quality, value, growth, strong buy, CFA top, etc. |
| **Custom filters** | min ROE/ROCE, max P/E, min MOS, promoter holding |
| **Background runs** | Large scans via BullMQ worker (≥400 symbols, or ≥80 with TA flag) |
| **Job progress** | WebSocket + Redis pub/sub (final phase today; chunked planned) |
| **Promoter overlay** | PostgreSQL `promoter_holdings` merged into metrics |

---

## PHP vs Script Screener

| Aspect | PHP (`stock-verifier`) | Script Screener (`stock-verifier-v2`) |
|--------|------------------------|--------------------------------------|
| **Engine** | `NseStockScreener::run()` (~1600 lines) | `runLiveScreener()` + `screenSymbol()` |
| **UI** | `screener.php` — full form, TA toggles, export | `ScreenerPage` — universe, preset, maxScan |
| **Job API** | `screener-job.php?action=status` | `GET /api/v1/screener/jobs/:id` + WS |
| **Worker** | `exec php run-screener-job.php &` | BullMQ `sv-screener` |
| **Presets** | ~30 (fundamental + 10 TA + combined) | **7** implemented in `PRESET_FILTERS` |
| **TA filters** | Full `TechnicalAnalysisHelper` prefetch | `show_ta` affects threshold only — **no TA enrichment** |
| **Bulk universe** | Screener.in paginated table scrape | Per-symbol Yahoo + Screener.in fetch |
| **Table prefilter** | `passesTableGates()` before CFA | **None** — full fetch per symbol |
| **Parallel fetch** | Screener.in batch concurrency 4 | **Sequential** per symbol |
| **Progress** | Every 5 symbols during analyze | **Done only** (Phase 9 planned) |
| **Export** | `toPitchCsv()` | Not implemented |
| **Custom presets** | Form merge with preset | `screener_presets` table — no CRUD UI |
| **Analyze cache** | `screener_row:{preset}:{symbol}` | Not implemented |
| **ASM/GSM skip** | `ExchangeListLoader` | Not implemented |

---

## Why the new architecture is faster (at scale)

### 1. Non-blocking large scans

```
PHP sync:  API thread blocked up to 600s for inline runs
v2 sync:   Small scans inline in API (<400 symbols)
v2 async:  BullMQ job → worker; API returns jobId immediately
```

User can navigate away; WebSocket/poll for completion.

### 2. Redis stock cache (7-day TTL)

Second scan of same symbol within TTL:

```
fetchStockData → sv:stock:{SYMBOL} hit → skip Yahoo + Screener.in network
```

PHP has similar `stock` / `screener` cache via `DataCache`; v2 uses unified `sv:stock` key.

### 3. Universe list cached 24h

After `pnpm sync:indices`:

```
resolveUniverseSymbols → sv:universe:nifty500 (86400s) → no DB/CSV read per run
```

### 4. Horizontal worker scaling

BullMQ `sv-screener` queue concurrency **2**; multiple worker replicas can drain queue (stateless API).

### 5. Where v2 is **slower** today

| Gap | Impact |
|-----|--------|
| Sequential symbol loop | 200 symbols × 2 network calls ≈ minutes uncached |
| No table prefilter | PHP cheap-gates before MOS; v2 runs full `estimate()` per symbol |
| No Screener.in bulk load | PHP loads universe table once; v2 fetches per symbol |
| Sample fallback on error | Fast but inaccurate rows |

**Phase S-B** (below) targets parallel fetch + prefilter parity.

### Latency budget

| Scenario | Target (warm cache) | Current |
|----------|---------------------|---------|
| 50 symbols sync | <30s | ~30–90s |
| 200 symbols background | User waits 0s (async) | Job 3–8 min |
| Job status poll | <100ms | ~50ms |
| Repeat symbol (cached) | <200ms/symbol | ~100–300ms |

---

## System architecture

```
┌──────────────┐   POST /screener/run    ┌─────────────┐
│ ScreenerPage │ ───────────────────────►│   Fastify   │
└──────────────┘   WS /ws/jobs/:id       └──────┬──────┘
                                                 │
                    ┌────────────────────────────┼────────────────────┐
                    ▼                            ▼                    ▼
             ┌─────────────┐              ┌─────────────┐       ┌─────────────┐
             │ PostgreSQL  │              │   BullMQ    │       │    Redis    │
             │ jobs table  │              │ sv-screener │       │ sv:stock    │
             └─────────────┘              └──────┬──────┘       │ sv:job:prog │
                                                 │              └─────────────┘
                                                 ▼
                                          ┌─────────────┐
                                          │   Worker    │
                                          │runLiveScreen│
                                          └──────┬──────┘
                                                 │
                    ┌────────────────────────────┼────────────────────┐
                    ▼                            ▼                    ▼
             ┌─────────────┐              ┌─────────────┐       ┌─────────────┐
             │  @sv/core   │              │ data-adapters│       │ Screener.in │
             │ screenSymbol│◄─────────────│ fetchStock   │       │ Yahoo       │
             │ estimate()  │              │ Data         │       └─────────────┘
             └─────────────┘              └─────────────┘
```

---

## Data flow

### Run request

```
POST /api/v1/screener/run
  { universe, preset, maxScan, background?, filters? }
    → resolveUniverseSymbols(universe, maxScan)
    → shouldRunInBackground(maxScan, filters.show_ta)
    → prisma.job.create(type: screener)
    → if background: enqueueScreenerJob
       else: runLiveScreener() inline + setJobProgress(done)
```

### Per-symbol pipeline (v2)

```
for each symbol (sequential):
  resolveStockMetrics(symbol)
    → fetchStockData (Yahoo + Screener.in → Redis sv:stock)
    → applyPromoterHolding (PostgreSQL)
  screenSymbol(symbol, metrics)
    → estimate() → CfaValuationEngine
    → matrixVerdict() → recommendation
  passesFilters(row, preset + custom)
  sort by MOS descending
```

### PHP per-symbol pipeline (reference)

```
prefetch TA charts (if active)
for each symbol:
  ASM/GSM skip
  passesTableGates (cheap)
  optional screener_row cache
  enrichStockForMos (Yahoo + promoter)
  TA enrich (if active)
  CfaStockAnalyzer::analyze()
  attachParityHint (verify cache)
  min_score / recommendation filter
```

---

## Presets & filters

### v2 implemented presets (`PRESET_FILTERS`)

| Key | Focus |
|-----|-------|
| `quality` | High ROE/ROCE, reasonable P/E |
| `strong_buy` | High MOS + strong recommendation |
| `buy_picks` | Buy-eligible tier |
| `fair_mos` | MOS in fair band |
| `value` | Low P/E, positive MOS |
| `growth` | Sales/profit growth |
| `cfa_top` | Top composite score |

API also lists: `GET /api/v1/presets` (same 7 keys).

Constants in `SCREENER_PRESETS` include `ta_pullback`, `ta_momentum`, `ta_oversold` — **not implemented** in filter logic.

### v2 custom filters (`screenerRunSchema.filters`)

| Filter | Type |
|--------|------|
| `min_roe` | number |
| `min_roce` | number |
| `min_mos` | number |
| `max_pe` | number |
| `min_promoter_holding` | number |
| `show_ta` | boolean (background threshold only) |

### PHP presets not yet in v2

**Fundamental:** `defensive`, `deep_value`, `buy_zone`, `near_iv`, `moat_compounders`, `monopoly_stocks`, `cfa_ltg_conviction`, `cfa_ltg_auto`

**TA:** `ta_technical`, `ta_pullback`, `ta_green_dma20`, `ta_momentum`, `ta_oversold`, `ta_golden_cross`, etc.

**Combined:** `cfa_moat_bottom`, `cfa_moat_uptrend`, `cfa_best_opportunity`

---

## Universe resolution

See [REDIS-CACHE.md](REDIS-CACHE.md#universe-resolution).

| Universe | Source after `sync:indices` |
|----------|----------------------------|
| nifty50 | ~50 symbols |
| nifty500 | ~750 symbols |
| total_nse | Admin NSE `EQUITY_L.csv` upload |
| custom | `POST /api/v1/universes` |

`maxScan`: 10–2000 (default 200). Empty universe in production → no results (run `pnpm sync:indices`).

---

## Background jobs

| Constant | Value |
|----------|-------|
| `BACKGROUND_THRESHOLD` | 400 symbols (fundamental) |
| `BACKGROUND_THRESHOLD_TA` | 80 symbols (`show_ta: true`) |
| Queue | `sv-screener` |
| Worker concurrency | 2 |
| Retries | 2, exponential backoff 5s |

### Job lifecycle

`pending` → `running` → `done` | `failed`

Progress shape (today): `{ phase: 'done', total, processed, passed }` at completion only.

### WebSocket

`WS /ws/jobs/:id` subscribes to Redis channel `job:{id}` — `ScreenerPage` uses this for background runs.

---

## Cache layers

| Redis key | TTL | Content |
|-----------|-----|---------|
| `sv:stock:{SYMBOL}` | 7d | Merged Yahoo + Screener.in metrics |
| `sv:screener:row:{SYMBOL}` | 1h | Reserved for row cache (not wired) |
| `sv:screener:table:{slug}` | 24h | Bulk table (adapter support) |
| `sv:universe:{key}` | 24h | Symbol array |
| `sv:job:progress:{jobId}` | 1h | Job progress + pub/sub |

---

## API mapping (PHP → v2)

| PHP | Script Screener |
|-----|-----------------|
| POST `screener.php` | `POST /api/v1/screener/run` |
| GET `screener.php?run=1&preset=` | Same POST with body |
| `screener-job.php?action=status&id=` | `GET /api/v1/screener/jobs/:id` |
| Job poll 2s (JS) | WebSocket + 2s poll in `ScreenerPage` |
| POST `export=pitch` | Not implemented |
| Universe CRUD (admin) | `GET/POST /api/v1/universes` |
| `cache.php` uploads | Admin page uploads |

### Request example

```http
POST /api/v1/screener/run
{
  "universe": "nifty100",
  "preset": "quality",
  "maxScan": 200,
  "filters": { "min_mos": 15, "min_roe": 12 }
}
```

Response (background):

```json
{ "jobId": "...", "status": "pending", "background": true, "symbolCount": 200 }
```

---

## UI surfaces

### `/screener` — `ScreenerPage.tsx`

- Universe dropdown (`GET /api/v1/universes`)
- Preset select (7 options)
- Max scan input
- Run → results table: symbol, price, P/E, ROE, MOS, zone, recommendation
- Background: progress message + WebSocket

**Missing vs PHP:** TA toggles, sort options, filter form, row expand CFA detail, CSV export, custom universes UI, background auto-checkbox.

---

## Parity matrix

| Feature | PHP | v2 | Gap |
|---------|-----|-----|-----|
| CFA valuation engine | ✓ | ✓ tested | — |
| 7 core presets | subset of 30 | ✓ | — |
| Live Yahoo + Screener.in | ✓ | ✓ | — |
| Background jobs | ✓ | ✓ BullMQ | — |
| WebSocket progress | poll only | ✓ WS | incremental % missing |
| Promoter holding overlay | ✓ | ✓ DB | — |
| TA presets / enrich | ✓ | ✗ | Phase S-C |
| 20+ presets | ✓ | 7 | Phase S-C |
| Table prefilter | ✓ | ✗ | Phase S-B |
| Parallel symbol fetch | batch 4 | ✗ | Phase S-B |
| Pitch CSV export | ✓ | ✗ | Phase S-D |
| ASM/GSM exclude | ✓ | ✗ | Phase S-D |
| Fundamental auto-screener | ✓ | ✗ | Phase 10 |
| Custom preset CRUD | ✓ | schema only | Phase 11 |
| Analyze row cache | ✓ | ✗ | Phase S-B |
| verify cache in rows | ✓ | ✗ | Phase 9 |

---

## Speed optimization plan

### Phase S-A — Job UX (1 day)

| # | Task |
|---|------|
| S-A1 | Chunked progress every 5 symbols in worker (match PHP) |
| S-A2 | ScreenerPage progress bar: `processed / total` |
| S-A3 | Wire `sv:verify` cache on verify → screener row hint |

### Phase S-B — Throughput (2–3 days)

| # | Task | Impact |
|---|------|--------|
| S-B1 | Parallel `runLiveScreener` with concurrency 5–8 | 5× faster jobs |
| S-B2 | `passesTableGates` cheap filter before `fetchStockData` | Skip network for obvious fails |
| S-B3 | Per-preset analyze cache `sv:screener:row:{preset}:{sym}` | Repeat runs instant |
| S-B4 | Optional Screener.in bulk table for `total_nse` | Match PHP bulk path |

### Phase S-C — Preset parity (3–5 days)

| # | Task |
|---|------|
| S-C1 | Port TA preset keys + `TechnicalAnalysisHelper` enrichment |
| S-C2 | Port remaining fundamental presets |
| S-C3 | Sort options (score, mos, pe, recommendation) |
| S-C4 | Extended filter form in UI |

### Phase S-D — Export & ops (1–2 days)

| # | Task |
|---|------|
| S-D1 | `toPitchCsv` export endpoint + UI button |
| S-D2 | `ExchangeListLoader` / ASM-GSM skip |
| S-D3 | Screener health banner (fetch fail rate) |

### Acceptance criteria

- [ ] 200-symbol job (warm cache) completes < **3 minutes**
- [ ] Progress updates every 5 symbols in UI
- [ ] No sample_fallback rows when Yahoo/Screener.in available
- [ ] At least **15 presets** with PHP-equivalent filters

---

## File reference

### Script Screener (v2)

```
packages/core/src/screener.ts          PRESET_FILTERS, screenSymbol, runScreener
packages/core/src/cfa-valuation-engine.ts
packages/data-adapters/src/screener-run.ts   runLiveScreener
packages/data-adapters/src/screener-in.ts
packages/data-adapters/src/stock-data-fetcher.ts
packages/jobs/src/index.ts             sv-screener queue
apps/api/src/services/screener.ts      createScreenerJob
apps/worker/src/worker.ts              processScreenerJob
apps/web/src/pages/ScreenerPage.tsx
```

### PHP reference

```
screener.php
screener-job.php
run-screener-job.php
includes/NseStockScreener.php
includes/ScreenerInputResolver.php
includes/ScreenerRunHelper.php
includes/ScreenerJob.php
includes/CfaStockAnalyzer.php
fundamental-auto-screener.php
```

### Tests

```
packages/core/src/parity.test.ts       CFA valuation parity
packages/core/src/valuation.test.ts
```

---

## Related docs

- [API Reference](API.md) — screener endpoints
- [CFA Verify](CFA-VERIFY.md) — screening funnel into Full Verify
- [Full Verify](FULL-VERIFY.md) — allocation gate after quality screen
- [Redis & Cache](REDIS-CACHE.md)
- [Packages](PACKAGES.md) — `@sv/core`
- [Milestones M3](MILESTONES.md)
- [Trading Strategies](TRADING-STRATEGIES.md) — positional engine + preset expansion (TS-D)
- [Roadmap Phase 10–11](ROADMAP.md) — LTG auto, strategy builder
