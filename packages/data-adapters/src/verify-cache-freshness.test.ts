import { describe, expect, it } from 'vitest';
import {
  isVerifyCachePriceStale,
  verifyPriceDriftPct,
  VERIFY_PRICE_STALE_PCT,
} from './verify-cache-freshness.js';

describe('verify cache price freshness', () => {
  it('matches PHP 1% stale threshold', () => {
    expect(VERIFY_PRICE_STALE_PCT).toBe(1);
    expect(verifyPriceDriftPct(100, 101.1)).toBeCloseTo(1.1, 5);
    expect(isVerifyCachePriceStale(100, 101.1)).toBe(true);
    expect(isVerifyCachePriceStale(100, 100.9)).toBe(false);
    expect(isVerifyCachePriceStale(100, 98.9)).toBe(true);
  });

  it('ignores missing prices', () => {
    expect(isVerifyCachePriceStale(0, 100)).toBe(false);
    expect(isVerifyCachePriceStale(100, 0)).toBe(false);
    expect(isVerifyCachePriceStale(undefined, 100)).toBe(false);
  });
});
