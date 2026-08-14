import { describe, expect, it } from 'vitest';
import { resolveExitProfile } from './exit-profile.js';
import {
  exitProfileFromEvidence,
  partialWeightForAction,
  remainingPctAfterSale,
  sharesForPartialWeight,
} from './partial-book.js';

describe('partial-book', () => {
  it('sizes T1/T2 shares from stratzy weights', () => {
    const profile = resolveExitProfile('stratzy_trend');
    expect(sharesForPartialWeight(100, 100, profile.weights[0])).toBe(70);
    expect(sharesForPartialWeight(100, 35, profile.weights[1])).toBe(20);
    expect(remainingPctAfterSale(100, 35)).toBe(35);
  });

  it('maps actions to weights and evidence presets', () => {
    expect(partialWeightForAction('PARTIAL_T1', resolveExitProfile('as_planned'))).toBe(0.4);
    expect(partialWeightForAction('PARTIAL_T2', resolveExitProfile('stratzy_trend'))).toBe(0.2);
    expect(exitProfileFromEvidence({ preset: 'ma20_stratzy' }).id).toBe('stratzy_trend');
    expect(exitProfileFromEvidence({ exit_profile: 'quick_scalp' }).id).toBe('quick_scalp');
  });
});
