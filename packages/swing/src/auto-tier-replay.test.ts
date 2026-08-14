import { describe, expect, it } from 'vitest';
import {
  classifyAutoTiersAtEntry,
  isStructuralHighConviction,
  AUTO_TIER_IDS,
} from './auto-tier-replay.js';

describe('auto tier replay (Phase D)', () => {
  it('classifies strict / setup / breakout / structural HC', () => {
    const hit = {
      strict_verdict: 'ENTER',
      verdict: 'ENTER',
      strict_enter_ready: true,
      r_multiple_ok: true,
      entry_score: 90,
      volume_surge: true,
      broke_swing_high: true,
      ta_volume_ratio: 1.2,
      ta_rsi14: 55,
      ta_pct_52w: 60,
    };
    const tiers = classifyAutoTiersAtEntry(hit);
    expect(tiers).toEqual(expect.arrayContaining([...AUTO_TIER_IDS]));
    expect(isStructuralHighConviction(hit)).toBe(true);
  });

  it('rejects chase / extended / weak tape for structural HC', () => {
    expect(
      isStructuralHighConviction({
        strict_verdict: 'ENTER',
        r_multiple_ok: true,
        entry_score: 90,
        ta_rsi14: 75,
      }),
    ).toBe(false);
    expect(
      isStructuralHighConviction({
        strict_verdict: 'ENTER',
        r_multiple_ok: true,
        entry_score: 75,
        volume_surge: false,
        broke_swing_high: false,
      }),
    ).toBe(false);
  });

  it('puts SETUP discoveries on setup_radar only', () => {
    const tiers = classifyAutoTiersAtEntry({
      strict_verdict: 'WATCH',
      verdict: 'SETUP',
      ta_volume_ratio: 1.0,
    });
    expect(tiers).toEqual(['setup_radar']);
  });
});
