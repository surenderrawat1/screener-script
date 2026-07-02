# Trading Presets — Architecture & Speed Plan

**Trading Presets** are one-click trading profiles: bookmarkable URLs that open the right swing scan, ETF rotation, or intraday radar with filters pre-set. Three system presets ship in PHP — conservative swing, ETF rotation, and intraday session.

In **Script Screener v2 this feature does not exist.** Swing and intraday engines support the underlying filters (`gc9_only`, `min_verdict`, intraday `trend_scalp_5m`), but there is no preset registry, hub page, or deep-link wiring.

> Presets are starting points, not orders — adjust on the target page before sizing.

**Related:** [Morning Routine](MORNING-ROUTINE.md) · [Swing Auto](SWING-AUTO.md) · [Nifty Intraday](INTRADAY.md) · [Swing Positions](SWING-POSITIONS.md)

---

## Table of contents

1. [What it does](#what-it-does)
2. [PHP vs Script Screener](#php-vs-script-screener)
3. [Three presets](#three-presets)
4. [URL encoding model](#url-encoding-model)
5. [Why the new architecture can be faster](#why-the-new-architecture-can-be-faster)
6. [System architecture (planned)](#system-architecture-planned)
7. [Preset → v2 route mapping](#preset--v2-route-mapping)
8. [Dependencies & blockers](#dependencies--blockers)
9. [API mapping (PHP → v2)](#api-mapping-php--v2)
10. [UI surfaces](#ui-surfaces)
11. [Parity matrix](#parity-matrix)
12. [Speed optimization plan](#speed-optimization-plan)
13. [Implementation phases](#implementation-phases)
14. [File reference](#file-reference)

---

## What it does

| Capability | Description |
|------------|-------------|
| **Three profiles** | Conservative swing · ETF rotation · Intraday session |
| **Bookmarkable URLs** | Query params encode full filter state — shareable links |
| **Hub page** | `trading-presets.php` — cards with rules + action links |
| **Morning chips** | Quick-launch on `morning-dashboard.php` |
| **Alias IDs** | `swing` → conservative, `etf` → rotation, `scalp` → intraday |
| **Primary CTA** | Each preset highlights one primary link per card |
| **Secondary links** | Regime check, positions, backtest, sub-scans |
| **NSE session** | Session banner on hub page |
| **Guide banner** | Accuracy tips (Tier-A, regime, backtest) |

---

## PHP vs Script Screener

| Aspect | PHP (`stock-verifier`) | Script Screener (`stock-verifier-v2`) |
|--------|------------------------|--------------------------------------|
| **Hub page** | `trading-presets.php` (nav: Trading Presets) | **No route** |
| **Planned route** | — | `/presets` |
| **Registry** | `TradingPreset.php` (3 presets) | **Not ported** |
| **API** | SSR only | **No** `GET /api/v1/trading/presets` |
| **Morning chips** | On `morning-dashboard.php` | **Not implemented** |
| **Conservative swing URL** | `swing-trading.php` + Tier-A + ENTER + GC9 | `/swing` — manual form, no `swing_tier_a` universe |
| **ETF rotation URL** | `swing-trading.php?mode=etf` | **No ETF mode / universe** |
| **Intraday URL** | `nifty-15m.php`, `intraday-app.php` | `/intraday` — no preset deep link |
| **Swing Auto strict** | `?tier=strict_enter` | `/swing/auto` — tiers exist, **no URL param** |
| **Backtest link** | `nifty-intraday-backtest.php` | **Not ported** |
| **Tests** | `validate-logic.php` `testTradingPresets()` | **None** |
| **User custom presets** | `strategies.php` (separate) | M11 `screener_presets` (planned) |

**Distinction:** Trading Presets are **fixed system profiles** with encoded URLs. [Trading Strategies](TRADING-STRATEGIES.md) is the **21-strategy research catalog** (swing / screener / hybrid runner). M11 Strategy Builder is for **user-defined** saved strategies — different feature.

---

## Three presets

### 1. Conservative swing (`conservative_swing`)

| Field | Value |
|-------|-------|
| **Icon / tone** | 🛡 · success (green) |
| **Horizon** | Days to weeks |
| **Intent** | Tier-A book · strict ENTER only · fresh GC9 |

**Rules (PHP copy):**

- Universe: curated Tier-A swing book (12 validated NSE names)
- Verdict: strict ENTER (E1–E8 + price action), not SETUP discovery
- GC9 filter: only names with live golden-cross entry trigger
- Check NIFTYBEES regime on Swing Trading before adding size

**Primary link:** Tier-A ENTER scan (`min_verdict=ENTER`, `gc9_only=1`, universe `swing_tier_a`)

**Secondary links:** Swing Auto strict ENTER · Swing positions · Regime (NIFTYBEES)

### 2. ETF rotation (`etf_rotation`)

| Field | Value |
|-------|-------|
| **Icon / tone** | ↻ · warning (amber) |
| **Horizon** | Weeks |
| **Intent** | Index + sector ETF book · SETUP+ discovery |

**Rules:**

- Book: liquid index & sector ETFs (excludes thematic, gold, global)
- Verdict: SETUP+ — discovery ENTER or SETUP; confirm strict ENTER on symbol view
- Regime banner uses NIFTYBEES — check underlying mismatch on sector names
- Prefer high-liquidity BeES; avoid low-liquidity niche ETFs for size

**Primary link:** ETF rotation scan (`mode=etf`, `etf_category=rotation`, `min_verdict=SETUP_PLUS`)

**Secondary links:** Index ETFs only · Sector ETFs only · ETF positions

### 3. Intraday session (`intraday_session`)

| Field | Value |
|-------|-------|
| **Icon / tone** | ⚡ · danger (red) |
| **Horizon** | Same day |
| **Intent** | 5m trend scalp + 15m CFA precision |

**Rules:**

- 5m: `trend_scalp_5m` gates (10:15 IST, trend day, skip chop) + quick_scalp exits (0.8/1.5/2.2R)
- 15m: CFA precision preset — MTF, regime map, precision partials
- Log entries on Nifty Positions; flatten by time stop (14:45–15:15 IST)
- Backtest 60d combo matrix before live size

**Primary links:** Intraday app (mobile) · 5m radar · 15m CFA precision

**Secondary links:** Nifty positions ledger · 60d R:R backtest matrix

---

## URL encoding model

PHP design: **stateless deep links** — no server session; all config in query string.

### Conservative swing scan URL

```
swing-trading.php?run=1&mode=universe&universe=swing_tier_a&min_verdict=ENTER&gc9_only=1&sort_by=swing_rank
```

### ETF rotation scan URL

```
swing-trading.php?run=1&mode=etf&etf_category=rotation&min_verdict=SETUP_PLUS&sort_by=swing_rank
```

### Intraday URLs

```
nifty-15m.php?tf=5m
nifty-15m.php?tf=15m
intraday-app.php?tf=5m
nifty-intraday-backtest.php?run=1&mode=combo_compare&tf=5m
```

### v2 planned (React Router)

```
/presets?highlight=conservative_swing
/swing?preset=conservative_swing          → auto-fill + run
/swing/auto?tier=strict_enter
/intraday?interval=5m&preset=trend_scalp_5m
/intraday?interval=15m&preset=strict_mtf
```

Preset registry returns both **legacy PHP-style paths** (migration) and **v2 routes**.

---

## Why the new architecture can be faster

### 1. Preset metadata is static

`TradingPreset::all()` is pure config (~200 lines). v2 can:

- Ship as TypeScript module (zero runtime fetch for hub page)
- Optional `GET /api/v1/trading/presets` for mobile/PWA

First paint: **<50ms** (no network for static presets).

### 2. Deep link → immediate scan

PHP: click primary link → land on swing page → user may need to click Run again.

v2 planned: `/swing?preset=conservative_swing&autorun=1`

- Parse preset → POST `/api/v1/swing/scan` with frozen params
- Show results without second click

### 3. Cached scans per preset signature

Redis key from preset params:

```
sv:swing:scan:{hash(universe,min_verdict,gc9_only,...)}  TTL 10m
```

Second user (or morning refresh) with same conservative preset → cache hit.

### 4. Compose with Morning Routine

Morning page loads preset **labels + primary routes only** (~1KB). Full cards on `/presets`.

---

## System architecture (planned)

```
┌──────────────┐  GET /api/v1/trading/presets   ┌─────────────┐
│ PresetsPage  │ ◄────────────────────────────►│   Fastify   │
│  /presets    │                               └──────┬──────┘
│ Morning chips│                                      │
└──────┬───────┘                                      ▼
       │ deep link                           ┌──────────────────┐
       ▼                                       │ trading-presets  │
┌──────────────┐                              │ .ts (registry)   │
│ SwingScan    │◄── preset params ────────────└──────────────────┘
│ SwingAuto    │
│ Intraday     │
└──────────────┘
```

### Module shape (planned)

```typescript
// packages/swing/src/trading-presets.ts

export type TradingPresetLink = {
  href: string;
  label: string;
  primary?: boolean;
  route?: string;        // v2 React path
  scanBody?: object;     // POST body for autorun
};

export type TradingPreset = {
  id: string;
  label: string;
  icon: string;
  horizon: string;
  tone: 'success' | 'warning' | 'danger';
  description: string;
  rules: string[];
  links: TradingPresetLink[];
};

export function allPresets(): Record<string, TradingPreset>;
export function getPreset(id: string): TradingPreset | null;
export function normalizePresetId(id: string): string;
export function buildSwingScanBody(presetId: string): object | null;
```

---

## Preset → v2 route mapping

| Preset action | PHP target | v2 equivalent | Status |
|---------------|------------|---------------|--------|
| Tier-A ENTER scan | `swing-trading.php` universe | `POST /swing/scan` | Partial — no `swing_tier_a` |
| Swing Auto strict | `swing-auto-screener.php?tier=strict_enter` | `/swing/auto?tier=strict_enter` | Tier exists; URL param missing |
| ETF rotation scan | `swing-trading.php?mode=etf` | `POST /swing/scan` ETF universe | **Blocked** — no ETF catalog |
| Regime NIFTYBEES | symbol mode swing | `/swing/evaluate?symbol=NIFTYBEES` | Evaluate API exists |
| 5m trend scalp | `nifty-15m.php?tf=5m` | `/intraday?interval=5m` | Page exists; no preset param |
| 15m CFA precision | `nifty-15m.php?tf=15m` | `/intraday?interval=15m` | Same |
| Intraday app (PWA) | `intraday-app.php` | `/intraday` mobile layout | **Not built** (I-D in INTRADAY.md) |
| Nifty positions | `nifty-positions.php` | `/nifty/positions` | **Not built** |
| 60d backtest | `nifty-intraday-backtest.php` | — | Phase 12 |
| Swing positions | `swing-positions.php` | `/positions` | ✅ |

### Conservative swing → v2 scan body (planned)

```json
{
  "universe": "swing_tier_a",
  "min_verdict": "ENTER",
  "gc9_only": true,
  "sort_by": "swing_rank",
  "max_scan": 12
}
```

Requires **`swing_tier_a` universe** in PostgreSQL / universe registry (12 Tier-A symbols from PHP `SwingSamplePortfolio`).

### ETF rotation → v2 scan body (planned)

```json
{
  "universe": "swing_etf",
  "etf_category": "rotation",
  "min_verdict": "SETUP_PLUS",
  "sort_by": "swing_rank"
}
```

Requires **`SwingEtfUniverse` port** (~20 ETFs) — shared with [MORNING-ROUTINE.md](MORNING-ROUTINE.md) MR-D.

### Intraday session → v2 state (planned)

```http
GET /api/v1/intraday/nifty/state?interval=5m&preset=trend_scalp_5m
```

`@sv/intraday` already defines `trend_scalp_5m` in `entry-filter.ts` — wire preset id to filter options.

---

## Dependencies & blockers

| Dependency | Blocks preset | Doc |
|------------|---------------|-----|
| `swing_tier_a` universe (12 symbols) | Conservative swing primary scan | TP-C |
| `SwingEtfUniverse` + ETF scan mode | ETF rotation | [MORNING-ROUTINE.md](MORNING-ROUTINE.md) MR-D |
| `/swing?preset=&autorun=` | One-click conservative / ETF | TP-B |
| `/swing/auto?tier=strict_enter` | Conservative secondary link | [SWING-AUTO.md](SWING-AUTO.md) A4 |
| Nifty positions ledger | Intraday session secondary | [NIFTY-POSITIONS.md](NIFTY-POSITIONS.md) |
| Intraday PWA / backtest | Intraday primary + backtest links | [INTRADAY.md](INTRADAY.md) I-D |
| `PriceFreshness::nseSession` | Hub session banner | [MORNING-ROUTINE.md](MORNING-ROUTINE.md) MR-A |

**Can ship early:** Hub page + preset registry + chips (static metadata only) without autorun.

---

## API mapping (PHP → v2)

| PHP | Planned v2 |
|-----|------------|
| GET `trading-presets.php` | `GET /api/v1/trading/presets` + `/presets` page |
| GET `trading-presets.php?preset=conservative_swing` | `/presets?highlight=conservative_swing` |
| `TradingPreset::get($id)` | `getPreset(id)` in `@sv/swing` |
| `TradingPreset::swingScanUrl()` | `buildPresetLink('conservative_swing', 'primary')` |
| Morning dashboard chips | `GET /api/v1/morning` includes `presets[]` slice |

### Proposed API response

```json
{
  "presets": [
    {
      "id": "conservative_swing",
      "label": "Conservative swing",
      "icon": "🛡",
      "horizon": "Days to weeks",
      "tone": "success",
      "description": "Tier-A book · strict ENTER only · fresh GC9 entry",
      "rules": ["Universe: curated Tier-A swing book (12 names).", "..."],
      "links": [
        {
          "label": "Run Tier-A ENTER scan",
          "primary": true,
          "route": "/swing?preset=conservative_swing&autorun=1",
          "scan": {
            "universe": "swing_tier_a",
            "min_verdict": "ENTER",
            "gc9_only": true
          }
        }
      ],
      "ready": false,
      "blocked_reason": "Universe swing_tier_a not configured"
    }
  ]
}
```

`ready: false` when dependencies missing — UI shows card but disables primary CTA with tooltip.

---

## UI surfaces

### PHP `trading-presets.php`

- NSE session banner
- Guide banner (accuracy tips)
- 3-column responsive card grid
- Active card highlight when `?preset=` in URL
- Per card: icon, label, horizon, description, rules list, pill action links

### PHP `morning-dashboard.php`

- `md-presets` chip row: primary link from each preset + "All presets →"
- First link per preset only (not full card)

### v2 planned

| Surface | Component |
|---------|-----------|
| `/presets` | `PresetsPage.tsx` — full hub |
| `/morning` | `PresetChips.tsx` — compact row |
| Nav | "Presets" item under Trading group |
| Dashboard | Optional "Trade today" card |

### Deep-link behavior (target pages)

| Page | Query params |
|------|----------------|
| `SwingScanPage` | `preset`, `autorun`, `universe`, `min_verdict`, `gc9_only` |
| `SwingAutoPage` | `tier=strict_enter` |
| `IntradayPage` | `interval`, `preset` |

---

## Parity matrix

| Feature | PHP | v2 | Gap |
|---------|-----|-----|-----|
| Hub page `/presets` | ✓ | ✗ | **TP-A** |
| 3 system presets | ✓ | ✗ | **TP-A** |
| ID aliases (`swing`, `etf`, `scalp`) | ✓ | ✗ | **TP-A** |
| Bookmarkable scan URLs | ✓ | ✗ | **TP-B** |
| Conservative → Tier-A + ENTER + GC9 | ✓ | partial | **TP-C** |
| ETF rotation → SETUP+ ETF scan | ✓ | ✗ | **TP-D** (ETF universe) |
| Intraday → 5m/15m links | ✓ | partial | **TP-B** |
| Swing Auto strict ENTER link | ✓ | partial | **TP-B** |
| Morning preset chips | ✓ | ✗ | **TP-E** |
| NSE session on hub | ✓ | ✗ | **TP-A** |
| `validate-logic` preset tests | ✓ | ✗ | **TP-F** |
| User custom strategies | M11 CRUD | M11 | separate track |
| Full strategy catalog | `strategies.php` | — | [TRADING-STRATEGIES.md](TRADING-STRATEGIES.md) |
| REST JSON API | ✗ | planned | v2 improvement |

---

## Speed optimization plan

### Phase TP-A — Registry & hub (1–2 days)

| # | Task |
|---|------|
| TP-A1 | Port `TradingPreset.php` → `packages/swing/src/trading-presets.ts` |
| TP-A2 | `GET /api/v1/trading/presets` — static JSON + `ready` flags |
| TP-A3 | `PresetsPage.tsx` at `/presets` — card grid |
| TP-A4 | `normalizePresetId()` aliases |
| TP-A5 | Nav item + link from Dashboard / Morning |

### Phase TP-B — Deep links & autorun (2–3 days)

| # | Task |
|---|------|
| TP-B1 | `SwingScanPage` reads `?preset=` + `?autorun=1` |
| TP-B2 | `SwingAutoPage` reads `?tier=strict_enter` |
| TP-B3 | `IntradayPage` reads `?preset=trend_scalp_5m` / `strict_mtf` |
| TP-B4 | Map preset → POST body / GET query for each target |
| TP-B5 | Share/copy link button on preset cards |

### Phase TP-C — Conservative swing universe (1–2 days)

| # | Task |
|---|------|
| TP-C1 | Add `swing_tier_a` universe (12 symbols from `SwingSamplePortfolio`) |
| TP-C2 | `pnpm sync` or seed script for Tier-A constituents |
| TP-C3 | Mark conservative preset `ready: true` |
| TP-C4 | Parity: conservative URL contains ENTER + gc9_only + swing_tier_a |

### Phase TP-D — ETF rotation (depends on ETF universe)

| # | Task |
|---|------|
| TP-D1 | Port `SwingEtfUniverse` (shared with Morning MR-D) |
| TP-D2 | Swing scan `mode=etf` + `etf_category=rotation` filter |
| TP-D3 | ETF rotation preset primary autorun |
| TP-D4 | Secondary links: index-only, sector-only scans |

### Phase TP-E — Morning integration (1 day)

| # | Task |
|---|------|
| TP-E1 | `PresetChips` on `/morning` |
| TP-E2 | Include `presets` slice in `GET /api/v1/morning` |
| TP-E3 | Primary chip uses same routes as hub |

### Phase TP-F — Tests & cache (1 day)

| # | Task |
|---|------|
| TP-F1 | Port `testTradingPresets()` from `validate-logic.php` |
| TP-F2 | Optional scan result cache keyed by preset signature |
| TP-F3 | Document preset accuracy tips in hub guide banner |

### Acceptance criteria

- [ ] `/presets` shows 3 cards matching PHP labels, rules, and link count
- [ ] `?preset=conservative_swing` highlights active card
- [ ] Conservative autorun uses ENTER + gc9_only + swing_tier_a
- [ ] ETF preset disabled with clear message until ETF universe ships
- [ ] Intraday preset opens `/intraday?interval=5m` with trend_scalp filter applied
- [ ] Morning page shows 3 chips + "All presets"
- [ ] vitest preset URL parity tests pass

---

## Implementation phases

```
Now — no preset registry or hub
  │
  ├─► TP-A: trading-presets.ts + /presets hub
  │
  ├─► TP-B: Deep links + autorun on swing/intraday/auto
  │
  ├─► TP-C: swing_tier_a universe (conservative preset)
  │
  ├─► TP-D: ETF universe + rotation scan (with Morning MR-D)
  │
  ├─► TP-E: Morning chips
  │
  └─► TP-F: Parity tests + optional scan cache
```

**Milestone overlap:**

- **M10** Morning Routine — TP-E (chips)
- **M11** Strategy builder — user presets extend same `screener_presets` / strategy tables; system presets remain read-only

---

## File reference

### Script Screener (v2) — existing (partial)

```
apps/web/src/pages/SwingScanPage.tsx       gc9_only, min_verdict (manual)
apps/web/src/pages/SwingAutoPage.tsx       strict_enter tier (no URL param)
apps/web/src/pages/IntradayPage.tsx        interval 5m/15m (no preset param)
packages/intraday/src/entry-filter.ts      trend_scalp_5m preset ✅
packages/swing/src/scanner.ts              gc9_only, min_verdict ✅
packages/shared/src/schemas.ts             swing scan schema
```

### Script Screener (v2) — planned

```
packages/swing/src/trading-presets.ts
packages/swing/src/etf-universe.ts         shared with Morning MR-D
apps/api/src/services/trading-presets.ts
apps/web/src/pages/PresetsPage.tsx
apps/web/src/components/PresetChips.tsx
```

### PHP reference (stock-verifier)

```
trading-presets.php
includes/TradingPreset.php
includes/SwingSamplePortfolio.php      swing_tier_a universe (12 symbols)
includes/SwingEtfUniverse.php          ETF catalog (~20 symbols)
includes/TradingPreset.php             URL builders
morning-dashboard.php                  preset chips
strategies.php                         link to morning dashboard
validate-logic.php                     testTradingPresets()
includes/AppGuide.php                  trading_presets context
docs/USER-GUIDE.md                     preset workflow section
```

---

## Related docs

- [Morning Routine](MORNING-ROUTINE.md) — preset chips (TP-E)
- [Swing Auto](SWING-AUTO.md) — strict ENTER tier link
- [Swing Positions](SWING-POSITIONS.md) — conservative preset secondary
- [Nifty Intraday](INTRADAY.md) — intraday session preset filters
- [Nifty Positions](NIFTY-POSITIONS.md) — intraday ledger link
- [Trading Strategies](TRADING-STRATEGIES.md) — 21-strategy catalog (distinct from 3 presets)
- [Roadmap Phase 11](ROADMAP.md) — user strategy builder (extends presets)
- [Web UI](WEB-UI.md) — routes
