# CFA Glossary & Reference

Admin-editable definitions and formulas for Stock Verifier v2. The **runtime glossary** lives in PostgreSQL (`cfa_terms`); calculation **logic** remains in `@sv/core` TypeScript (parity-tested).

## Where to use

| Surface | URL | Who |
|---------|-----|-----|
| **CFA Reference** (read) | `/cfa-reference` | All logged-in users |
| **CFA Docs Admin** (edit) | `/admin/cfa-docs` | Admin only |
| **Admin home** | `/admin` | Links to both |

## Data model

Table `cfa_terms`:

| Field | Purpose |
|-------|---------|
| `key` | Stable snake_case id (e.g. `mos`, `intrinsic_value`) — used for API lookup and future UI tooltips |
| `category` | Grouping: `valuation`, `ratio`, `quality`, `quant`, `phase`, `verdict`, `screening` |
| `title` | Display name |
| `definition` | Plain-language explanation |
| `formula` | Optional formula / rule text (Markdown-friendly plain text) |
| `example` | Optional worked example |
| `phase_refs` | Full Verify phase numbers linked to this term |
| `related_keys` | Cross-links to other glossary keys |
| `sort_order` | Order within category |
| `is_active` | Hide from public reference when false |

## API

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/v1/cfa/terms` | Viewer+ |
| GET | `/api/v1/cfa/terms/:key` | Viewer+ |
| GET | `/api/v1/admin/cfa/terms` | Admin (includes inactive) |
| POST | `/api/v1/admin/cfa/terms` | Admin — create |
| PUT | `/api/v1/admin/cfa/terms/:key` | Admin — update |
| DELETE | `/api/v1/admin/cfa/terms/:key` | Admin |
| POST | `/api/v1/admin/cfa/terms/reseed` | Admin — reset defaults from codebase |

## Seeding defaults

Defaults are defined in `packages/db/src/cfa-terms-defaults.ts` (~30 terms covering MOS, DCF, phases, quality score, etc.).

```bash
cd packages/db
pnpm push          # apply schema
pnpm generate
pnpm seed          # seeds admin + CFA terms (skip existing keys)
```

**Reseed** from Admin → CFA Docs → **Reseed defaults** overwrites default keys with codebase text (custom edits on those keys are lost).

## What admins can change vs code

| Editable in DB (admin UI) | Fixed in code (`@sv/core`) |
|---------------------------|----------------------------|
| Definitions, help text, formulas *as documented* | Actual IV/MOS/quality calculations |
| Examples, phase cross-links | Sector routing, WACC, scorecard gates |
| New custom glossary entries | Parity with PHP `validate-logic.php` |

To change **numeric engine coefficients** (e.g. MOS zone thresholds), extend `config/cfa-engine.yaml` + `app_settings` in a future release — not the glossary table.

## Code map (source of truth for calculations)

| Topic | File |
|-------|------|
| Intrinsic value, DCF, Fair P/E, quality score | `packages/core/src/cfa-valuation-engine.ts` |
| MOS, Graham, matrix verdict | `packages/core/src/valuation.ts` |
| 8-phase evaluation | `packages/core/src/verification/phases.ts` |
| Full Verify form labels | `packages/core/src/verify-full/phases.ts` |
| Screening presets | `packages/core/src/screener.ts`, `config/presets/screener.yaml` |
| Default glossary seed | `packages/db/src/cfa-terms-defaults.ts` |
| API service | `apps/api/src/services/cfa-docs.ts` |

## Related docs

- [CFA-VERIFY.md](./CFA-VERIFY.md) — auto-verify architecture
- [FULL-VERIFY.md](./FULL-VERIFY.md) — 8-phase Full Verify
- [API.md](./API.md) — REST overview
