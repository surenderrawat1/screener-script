import { describe, expect, it } from 'vitest';
import { CACHE_PREFIX } from '@sv/shared';
import { cacheKey } from '@sv/cache';
import { intradayStateCacheKey } from './intraday-state-cache.js';

describe('intraday state snapshot key (I-A1)', () => {
  it('namespaces per instrument, TF, and accuracy-gate mode', () => {
    expect(intradayStateCacheKey('nifty50', '15m')).toBe(
      cacheKey(CACHE_PREFIX.INTRADAY, 'state:nifty50:15m:gate'),
    );
    expect(intradayStateCacheKey('NIFTYBEES', '5m', true)).toBe(
      cacheKey(CACHE_PREFIX.INTRADAY, 'state:niftybees:5m:nogate'),
    );
    expect(intradayStateCacheKey('SUNPHARMA', '15m')).not.toBe(intradayStateCacheKey('nifty50', '15m'));
  });

  it('does not collide NIFTYBEES with Nifty 50', () => {
    expect(intradayStateCacheKey('niftybees', '15m')).not.toBe(intradayStateCacheKey('nifty50', '15m'));
  });
});
