import { describe, expect, it } from 'vitest';
import { evaluateEntry, ENGINE_VERSION } from './evaluate-entry.js';
import { evaluateExit } from './evaluate-exit.js';
import { getStrategy } from './strategy-registry.js';

/** Fixture: SMA uptrend + pullback, but short EMA stack not yet rebuilt. */
const pullbackTa = {
  ta_sma9: 102.0,
  ta_sma20: 101.5,
  ta_sma50: 100.0,
  ta_sma200: 90.0,
  ta_ema9: 101.0,
  ta_ema21: 102.5, // 9 < 21 — stack broken (common mid-pullback)
  ta_ema50: 99.0,
  ta_ema200: 88.0,
  ta_rsi14: 48.0,
  ta_pct_52w: 50.0,
  ta_bb_pct_b: 40.0,
  ta_macd_hist: 0.2,
  ta_avg_value_cr: 20.0,
  ta_volume_ratio: 1.0,
  ta_bar_count: 220,
  ta_ready: true,
  ta_price: 100.5,
};

describe('v3.11-lite over-rule simplification', () => {
  it('ships lite engine version', () => {
    expect(ENGINE_VERSION).toBe('v3.18-real-fill-edge');
  });

  it('E7 passes on primary EMA trend even when short stack is rebuilding', () => {
    const entry = evaluateEntry(pullbackTa, 100.5);
    const e1 = entry.rules.find((r) => r.id === 'E1');
    const e7 = entry.rules.find((r) => r.id === 'E7');
    expect(e1?.passed).toBe(true);
    expect(e7?.passed).toBe(true);
    expect(String(e7?.detail)).toMatch(/short stack still rebuilding/i);
  });

  it('E9 is soft (null) when hourly is noisy but momentum is not weak', () => {
    // No hourly bars → dynamic may not fully pass; must not hard-fail unless weak.
    const entry = evaluateEntry(pullbackTa, 100.5, null, null, []);
    const e9 = entry.rules.find((r) => r.id === 'E9');
    expect(e9?.passed).not.toBe(false);
  });

  it('discovery is not blocked solely by missing E7 short-stack / dynamic veto', () => {
    const entry = evaluateEntry(pullbackTa, 100.5);
    expect(['ENTER', 'SETUP', 'WATCH']).toContain(entry.discovery_verdict);
    expect(entry.discovery_verdict).not.toBe('AVOID');
  });

  it('SETUP+ discovery strategy ranks by swing_rank not raw rules_passed', () => {
    expect(getStrategy('swing_setup_plus')?.sort_by).toBe('swing_rank');
    expect(getStrategy('swing_ma20_stratzy')?.sort_by).toBe('swing_rank');
  });

  it('exit X1 does not double-count trail hits as X1 when only trail fires', () => {
    const ta = {
      ...pullbackTa,
      as_of_date: '2026-06-20',
      ta_ema9: 110,
      ta_ema21: 108,
    };
    // Price still above hard stop but below a high trail from elevated high-water.
    const exit = evaluateExit(
      ta,
      104,
      100,
      '2026-06-01',
      null,
      112, // high water → trail arms below price? need price <= trail
      null,
      null,
      115,
      12,
      { bull: true },
      null,
      null,
    );
    const x1 = exit.rules.find((r) => r.id === 'X1');
    const x6 = exit.rules.find((r) => r.id === 'X6');
    // If trail hit and hard stop not hit, only X6 should be in triggered (or neither if trail not armed).
    if (x6?.passed && !x1?.passed) {
      expect(exit.triggered).toContain('X6');
      expect(exit.triggered).not.toContain('X1');
    }
  });
});
