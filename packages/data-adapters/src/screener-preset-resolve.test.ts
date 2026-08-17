import { describe, expect, it } from 'vitest';
import {
  buildScreenerPathFromStrategyKey,
  isUserScreenerPresetKey,
  resolveScreenerPresetFilters,
  userScreenerPresetIdFromKey,
} from './screener-preset-resolve.js';

describe('screener-preset-resolve', () => {
  it('detects user preset keys', () => {
    expect(isUserScreenerPresetKey('user_screener_preset:abc')).toBe(true);
    expect(userScreenerPresetIdFromKey('user_screener_preset:abc')).toBe('abc');
    expect(isUserScreenerPresetKey('quality')).toBe(false);
  });

  it('resolves system preset filters', async () => {
    const resolved = await resolveScreenerPresetFilters('quality');
    expect(resolved.presetKey).toBe('quality');
    expect(resolved.baseFilters.min_roe).toBeGreaterThan(0);
  });

  it('builds screener path for positional strategy', () => {
    const href = buildScreenerPathFromStrategyKey('pos_quality');
    expect(href).toContain('/screener?');
    expect(href).toContain('preset=quality');
    expect(href).toContain('universe=');
  });

  it('builds screener path for TA preset with show_ta', () => {
    const href = buildScreenerPathFromStrategyKey('pos_pullback_timing');
    expect(href).toContain('preset=ta_pullback');
    expect(href).toContain('show_ta=1');
  });

  it('returns null for swing-only strategy', () => {
    expect(buildScreenerPathFromStrategyKey('swing_strict_enter')).toBeNull();
  });
});
