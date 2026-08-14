import { describe, expect, it } from 'vitest';
import {
  getStrategy,
  isValidStrategy,
  listStrategies,
  readyStrategyCount,
  STRATEGY_ENGINE_SCREENER,
  STRATEGY_ENGINE_SWING,
  STRATEGY_STYLE_SWING,
} from './strategy-registry.js';

describe('strategy-registry', () => {
  it('lists 22 system strategies', () => {
    expect(listStrategies().length).toBe(22);
  });

  it('has swing strict enter on swing engine', () => {
    const s = getStrategy('swing_strict_enter');
    expect(s?.engine).toBe(STRATEGY_ENGINE_SWING);
    expect(s?.min_verdict).toBe('ENTER');
    expect(s?.ready).toBe(true);
  });

  it('marks positional quality as ready', () => {
    const s = getStrategy('pos_quality');
    expect(s?.engine).toBe(STRATEGY_ENGINE_SCREENER);
    expect(s?.preset).toBe('quality');
    expect(s?.ready).toBe(true);
  });

  it('marks moat compounders as ready after TS-D', () => {
    expect(getStrategy('pos_moat_compounders')?.ready).toBe(true);
  });

  it('marks hybrid moat swing as ready', () => {
    expect(getStrategy('hybrid_moat_swing')?.ready).toBe(true);
  });

  it('filters by style tab', () => {
    const swing = listStrategies(STRATEGY_STYLE_SWING);
    expect(swing.length).toBe(7);
    expect(swing.every((s) => s.style === STRATEGY_STYLE_SWING)).toBe(true);
  });

  it('has 20 MA Stratzy swing strategy requiring E12', () => {
    const s = getStrategy('swing_ma20_stratzy');
    expect(s?.ready).toBe(true);
    expect(s?.require_rules).toEqual(['E12']);
    expect(s?.sort_by).toBe('swing_rank');
  });

  it('SETUP+ discovery sorts by swing_rank (not raw rules_passed)', () => {
    expect(getStrategy('swing_setup_plus')?.sort_by).toBe('swing_rank');
  });

  it('validates keys', () => {
    expect(isValidStrategy('hybrid_quality_swing')).toBe(true);
    expect(isValidStrategy('nope')).toBe(false);
  });

  it('marks all 22 system strategies ready', () => {
    const blocked = listStrategies().filter((s) => !s.ready);
    expect(blocked).toEqual([]);
    expect(readyStrategyCount()).toBe(22);
  });

  it('has at least 18 ready strategies', () => {
    expect(readyStrategyCount()).toBeGreaterThanOrEqual(18);
  });
});
