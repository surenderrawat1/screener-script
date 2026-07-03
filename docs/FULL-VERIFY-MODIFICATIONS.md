# Full Verify — CFA Audit & Modification Log

**Auditor role:** Senior CFA Charterholder (equity research / portfolio gate)  
**Date:** 2026-07-03  
**Scope:** Script Screener v2 — `/verify/full` vs PHP `index.php` + `VerificationEngine`  
**Test symbol:** TCS (NSE) — live fetch + run

---

## Executive Summary

Full Verify is **~85% ported** and functionally usable. The engine, 9-phase form, fetch/autofill, scorecard (0–56), and investment-ready gate match PHP architecture. Recent fixes restored **Phase 2** (Screener annual enrichment), **Phase 4** (EPS/MOS), and **Phase 5** (Piotroski + unreliable Altman handling).

This document records CFA findings, priority modifications, and implementation status.

---

## Live Audit — TCS (post-enrichment)

| Area | Expected (CFA) | Observed | Status |
|------|----------------|----------|--------|
| Phase 2 EPS | Annual report EPS | 136.01 (Screener) | ✅ Fixed |
| Phase 2 CFO/FCF | Positive for TCS | 52,094 / 48,013 Cr | ✅ Fixed |
| Phase 2 EBITDA margin | ~25–30% IT | 27% | ✅ Fixed |
| Phase 4 Fair P/E IV | > 0 when EPS known | ~2,938 | ✅ Fixed |
| Phase 4 DCF IV | MOS input | ~2,181 | ✅ OK |
| Phase 4 52w range | Non-zero | ₹1,977–₹3,435 | ✅ Fixed |
| Phase 5 Piotroski | 0–9 estimate | 5 | ✅ OK |
| Phase 5 Altman Z | Reliable or blank | `unreliable` proxy | ✅ By design |
| Scorecard | 0–56 | 35/56 (Grade B) | ✅ OK |
| MOS | vs intrinsic | 28.4% deep value | ✅ OK |
| Investment ready | Manual gates block | `ready: false` | ✅ Correct |
| Verdict | Phase 0 incomplete | FIX PERSONAL FINANCE FIRST | ✅ Correct |

**Investment-ready blockers (correct behaviour):**

1. Phase 0 — investor readiness checkboxes (manual only)
2. Phase 5 — Altman Z unreliable until AR entry
3. Phase 7 — portfolio/position gates unanswered
4. D1–D7 — data quality (cache meta not passed on run)
5. `manual_attestation` unchecked after auto-fill

---

## Modification Register

### P0 — Implemented in this pass

| ID | Finding | Modification | Files |
|----|---------|--------------|-------|
| **MOD-01** | Yahoo `quoteSummary` blocked → Phase 2/4 zeros | Screener annual P&L + cash-flow enrichment; chart API for 52w | `screener-annual.ts`, `yahoo.ts`, `verifier-fetch.ts` |
| **MOD-02** | Empty form wiped fetched values | `FormState` placeholder guard; omit full `manual` on first fetch | `form-state.ts`, `VerifyFullPage.tsx` |
| **MOD-03** | Piotroski `-1` overwrote F-Score | Schema placeholder excluded from manual merge | `form-state.ts` |
| **MOD-04** | Absurd Altman Z in form | Omit Z when `unreliable`; show Phase 5 warning | `verifier-autofill.ts`, `PhasePanel.tsx` |
| **MOD-05** | `p2_de_ok`, `p2_bv_growing`, `p2_wc_ok` missing vs PHP | Autofill parity fields | `verifier-autofill.ts` |
| **MOD-06** | `def_execution_ok` gate with no form field | Add Defence Phase 6 field | `phases.ts` |
| **MOD-07** | `sectorHints` not wired on run → D2 fail for `general` | Port `nse_sector_hints`; wire on run + fetch sector from Screener industry | `nse-sector-hints.ts`, `verify-full.ts`, `screener-annual.ts` |
| **MOD-08** | Thesis drafts tagged AUTO | Exclude thesis/attestation from `auto_keys` | `verifier-autofill.ts` |
| **MOD-09** | Results panel thin vs PHP | Position size, red-flag list, D-gate detail | `VerifyFullResults.tsx` |
| **MOD-10** | Watchlist saves without thesis quality | Server `validateThesisInput` on watchlist sync | `watchlist.ts`, `verify-full.ts` |
| **MOD-11** | Run allowed without attestation UX | Client warn + disable Run when attestation invalid | `VerifyFullPage.tsx` |
| **MOD-12** | `dev:all` stale `@sv/core` dist | `predev:all` rebuilds packages | `package.json` |

### P1 — Backlog (documented, not in this pass)

| ID | Finding | Recommended action |
|----|---------|------------------|
| **MOD-13** | `FULL-VERIFY.md` says “not ported” | Update parity matrix |
| **MOD-14** | No golden scorecard test vs PHP (±2 pts) | Add fixture in `verification-engine.test.ts` |
| **MOD-15** | Server draft API (`PUT /verify/full/draft`) | Prisma `VerificationDraft` or reuse watchlist meta |
| **MOD-16** | CFA Auto → merge into Full Verify draft | `action=auto_verify` port from PHP |
| **MOD-17** | `nbfc` / `oil_gas` / `insurance` not in sector dropdown | Map via hints only (engine supports); optional UI labels |
| **MOD-18** | D1 cache gate always fails on run without `cacheMeta` | Pass Redis TTL metadata from fetch to run |
| **MOD-19** | Governance yes/no autofilled (`p1_auditor_clean`, etc.) | Mark manual-only or require Phase 1 attestation |
| **MOD-20** | Per-gate expandable UI in results | Phase accordion with gate notes |

### P2 — CFA Process Notes (no code change)

| Topic | Guidance |
|-------|----------|
| **Auto-fill ≠ approval** | AUTO badges mean “fetched — confirm”. Investment-ready requires attestation. |
| **Altman on asset-light IT** | Proxy often `unreliable`; enter AR components or reported Z. |
| **Phase 0** | Never auto-fill; blocks verdict until personal finance gates pass. |
| **Thesis** | Draft text from fetch is a starting point; rewrite before allocating capital. |
| **Screening vs Full Verify** | CFA `/verify` = memo; Full Verify = allocation gate with manual phases. |

---

## PHP Parity Matrix (updated)

| Component | PHP | v2 | Parity |
|-----------|-----|-----|--------|
| 9-phase form | ✅ | ✅ | Full |
| `FormState.mergeAuto` | ✅ | ✅ | Full |
| `mapToVerifierInput` | ✅ | ✅ | ~95% (sector KPIs manual both) |
| `VerificationEngine` | ✅ | ✅ | ~90% |
| Scorecard 0–56 | ✅ | ✅ | Full |
| `investmentReady()` | ✅ | ✅ | Full |
| Promoter pledge overlay | ✅ | ✅ | Full |
| EPS dual basis | ✅ | ✅ | Full |
| Hindi i18n | Partial | Partial | Partial |
| Session draft | Server | localStorage | Partial |

---

## Verification Checklist (CFA sign-off)

Before marking a stock **investment-ready** in production use:

- [ ] Phase 0 — all five investor-readiness boxes personally confirmed
- [ ] Phase 1 — circle of competence (1.1–1.4) answered **yes** manually
- [ ] Phase 2 — AR scan checkboxes reviewed (not just auto `1`)
- [ ] Phase 5 — Altman Z from annual report if proxy unreliable
- [ ] Phase 7 — position size and exit triggers completed
- [ ] Phase 8 — thesis rewritten; attestation checked
- [ ] Score ≥ 35/56, MOS ≥ 15%, ≤ 1 red flag, no critical fails
- [ ] D1–D7 data quality reviewed

---

## Related Docs

- [FULL-VERIFY.md](FULL-VERIFY.md) — feature spec (needs parity matrix update)
- [CFA-VERIFY.md](CFA-VERIFY.md) — screening memo path
- PHP reference: `tools/stock-verifier/index.php`, `validate-logic.php`
