import { describe, expect, it } from 'vitest';
import {
  isCachedBarsFresh,
  TA_DAILY_BARS_FRESH_MAX_AGE_SEC,
  TA_HOURLY_BARS_FRESH_MAX_AGE_SEC,
  taBarsCacheKey,
  taBarsFreshMaxAgeSec,
} from './swing-chart.js';

describe('TA bars freshness (Phase B2)', () => {
  it('uses 24h soft age for daily bars and 1h for hourly', () => {
    expect(TA_DAILY_BARS_FRESH_MAX_AGE_SEC).toBe(86_400);
    expect(TA_HOURLY_BARS_FRESH_MAX_AGE_SEC).toBe(3_600);
    expect(taBarsFreshMaxAgeSec('2y')).toBe(86_400);
    expect(taBarsFreshMaxAgeSec('5y')).toBe(86_400);
    expect(taBarsFreshMaxAgeSec('1h')).toBe(3_600);
    expect(taBarsFreshMaxAgeSec('4h')).toBe(3_600);
    expect(taBarsFreshMaxAgeSec('5m')).toBe(1_800);
    expect(taBarsFreshMaxAgeSec('15m')).toBe(1_800);
  });

  it('treats legacy payloads without cached_at as fresh (Redis EX gate)', () => {
    expect(isCachedBarsFresh(null, 86_400)).toBe(true);
    expect(isCachedBarsFresh(undefined, 86_400)).toBe(true);
    expect(isCachedBarsFresh('', 86_400)).toBe(true);
  });

  it('accepts cached_at within max age and rejects stale', () => {
    const now = Date.parse('2026-08-10T10:00:00.000Z');
    const fresh = new Date(now - 3_600_000).toISOString();
    const stale = new Date(now - 90_000_000).toISOString();
    expect(isCachedBarsFresh(fresh, 86_400, now)).toBe(true);
    expect(isCachedBarsFresh(stale, 86_400, now)).toBe(false);
    expect(isCachedBarsFresh(fresh, 3_600, now)).toBe(true);
    expect(isCachedBarsFresh(new Date(now - 3_601_000).toISOString(), 3_600, now)).toBe(false);
  });

  it('rejects invalid cached_at timestamps', () => {
    expect(isCachedBarsFresh('not-a-date', 86_400)).toBe(false);
  });

  it('builds stable TA bars cache keys for MGET preload', () => {
    expect(taBarsCacheKey('tcs')).toContain('TCS');
    expect(taBarsCacheKey('TCS.NS', '2y')).toBe(taBarsCacheKey('TCS', '2y'));
    expect(taBarsCacheKey('HAL', '1h').toUpperCase()).toContain('1H');
    expect(taBarsCacheKey('HAL', '1h')).not.toBe(taBarsCacheKey('HAL', '2y'));
    expect(taBarsCacheKey('HAL', '5m').toUpperCase()).toContain('5M');
    expect(taBarsCacheKey('HAL', '4h').toUpperCase()).toContain('240M');
    expect(taBarsCacheKey('HAL', '1w').toUpperCase()).toContain('1W');
  });
});
