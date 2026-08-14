import { describe, expect, it } from 'vitest';
import { fromTa, BIAS_LONG, BIAS_SHORT, SMA20_PULLBACK_PCT } from './sma20-stratzy.js';

describe('sma20-stratzy swing E12', () => {
  it('entry_ok on pullback above SMA-20', () => {
    const state = fromTa({ ta_sma20: 100 }, 101);
    expect(state.bias).toBe(BIAS_LONG);
    expect(state.entry_ok).toBe(true);
    expect(state.near).toBe(true);
  });

  it('structure_ok but not entry when extended', () => {
    const extended = 100 * (1 + (SMA20_PULLBACK_PCT + 1) / 100);
    const state = fromTa({ ta_sma20: 100 }, extended);
    expect(state.structure_ok).toBe(true);
    expect(state.entry_ok).toBe(false);
  });

  it('fails below SMA-20', () => {
    const state = fromTa({ ta_sma20: 100 }, 98);
    expect(state.bias).toBe(BIAS_SHORT);
    expect(state.entry_ok).toBe(false);
  });
});
