import { describe, expect, it } from 'vitest';
import {
  upcomingRotateSymbols,
  SWING_TA_PREWARM_BATCHES_AHEAD,
  SWING_TA_PREWARM_CONCURRENCY,
} from './swing-ta-prewarm.js';

describe('swing TA pre-warm (Phase B3)', () => {
  it('uses low concurrency and two batches ahead', () => {
    expect(SWING_TA_PREWARM_CONCURRENCY).toBe(3);
    expect(SWING_TA_PREWARM_BATCHES_AHEAD).toBe(2);
  });

  it('upcomingRotateSymbols wraps and dedupes', () => {
    const universe = ['a', 'b', 'c', 'd', 'e'];
    expect(upcomingRotateSymbols(universe, 0, 1, 2)).toEqual(['A', 'B']);
    expect(upcomingRotateSymbols(universe, 4, 1, 2)).toEqual(['E', 'A']);
    expect(upcomingRotateSymbols(universe, 0, 2, 30).length).toBe(5);
    expect(upcomingRotateSymbols([], 0)).toEqual([]);
  });
});
