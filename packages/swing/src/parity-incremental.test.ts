import { describe, expect, it } from 'vitest';
import {
  FULL_SCAN_INTERVAL_SEC,
  MODE_FULL,
  MODE_INCREMENTAL,
  buildRefreshSet,
  mergeHits,
  shouldRunFullScan,
} from './incremental-scan.js';
import { FULL_SCAN_INTERVAL_SEC as AUTO_FULL_SCAN_SEC, SCAN_INTERVAL_SEC } from './auto-screener.js';

describe('swing incremental scan parity', () => {
  it('null snapshot triggers full scan', () => {
    expect(shouldRunFullScan(null, null)).toBe(true);
  });

  it('fresh snapshot same regime uses incremental', () => {
    const recentFull = {
      last_full_scan_at: new Date().toISOString(),
      saved_at: new Date().toISOString(),
      scan: { regime: { key: 'bull' }, hits: [{ symbol: 'TCS' }] },
    };
    expect(shouldRunFullScan(recentFull, 'bull')).toBe(false);
    expect(shouldRunFullScan(recentFull, 'bear')).toBe(true);
  });

  it('stale full interval triggers full scan', () => {
    const staleFull = {
      last_full_scan_at: new Date(Date.now() - (FULL_SCAN_INTERVAL_SEC + 60) * 1000).toISOString(),
      saved_at: new Date().toISOString(),
      scan: { regime: { key: 'bull' }, hits: [{ symbol: 'TCS' }] },
    };
    expect(shouldRunFullScan(staleFull, 'bull')).toBe(true);
  });

  it('refresh set includes prior hits and rotates', () => {
    const snapshot = {
      rotate_offset: 0,
      scan: {
        hits: [
          { symbol: 'TCS', swing_rank: 80, rules_passed: 5 },
          { symbol: 'INFY', swing_rank: 70, rules_passed: 4 },
        ],
      },
    };
    const universe = ['TCS', 'INFY', 'WIPRO', 'RELIANCE', 'HDFCBANK', 'ITC'];
    const refresh = buildRefreshSet(snapshot, universe, [], 5);
    expect(refresh.symbols.length).toBeGreaterThanOrEqual(2);
    expect(refresh.symbols).toContain('TCS');
    expect(refresh.rotate_offset > 0 || refresh.components.rotate.length > 0).toBe(true);
  });

  it('merge keeps carried hits and re-sorts refreshed', () => {
    const previous = [
      { symbol: 'TCS', swing_rank: 80, rules_passed: 5 },
      { symbol: 'INFY', swing_rank: 70, rules_passed: 4 },
      { symbol: 'WIPRO', swing_rank: 60, rules_passed: 3 },
    ];
    const fresh = [{ symbol: 'TCS', swing_rank: 85, rules_passed: 6 }];
    const merged = mergeHits(previous, fresh, ['TCS'], 'swing_rank');
    const syms = merged.map((h) => h.symbol);
    expect(merged).toHaveLength(3);
    expect(syms).toContain('INFY');
    expect(syms).toContain('WIPRO');
    expect(merged[0]?.symbol).toBe('TCS');
  });

  it('merge drops symbol that failed refresh', () => {
    const previous = [
      { symbol: 'TCS', swing_rank: 80, rules_passed: 5 },
      { symbol: 'INFY', swing_rank: 70, rules_passed: 4 },
    ];
    const dropped = mergeHits(previous, [], ['INFY'], 'swing_rank');
    const droppedSyms = dropped.map((h) => h.symbol);
    expect(droppedSyms).not.toContain('INFY');
    expect(droppedSyms).toContain('TCS');
  });

  it('scan modes and intervals align with PHP', () => {
    expect(MODE_FULL).toBe('full');
    expect(MODE_INCREMENTAL).toBe('incremental');
    expect(SCAN_INTERVAL_SEC).toBe(300);
    expect(AUTO_FULL_SCAN_SEC).toBe(FULL_SCAN_INTERVAL_SEC);
    expect(FULL_SCAN_INTERVAL_SEC).toBe(1800);
  });
});
