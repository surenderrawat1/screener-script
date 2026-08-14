import { describe, expect, it } from 'vitest';
import { resolveExitProfile, targetsFromProfile } from './exit-profile.js';
import { simulateScaledTrade } from './intraday-backtest.js';
import type { IntradayBar } from './nifty-direction.js';

function bar(partial: Partial<IntradayBar> & { close: number }): IntradayBar {
  return {
    time: partial.time ?? '2024-01-02T04:00:00.000Z',
    time_label: partial.time_label ?? '2024-01-02 09:30',
    open: partial.open ?? partial.close,
    high: partial.high ?? partial.close,
    low: partial.low ?? partial.close,
    close: partial.close,
    volume: partial.volume ?? 1000,
  };
}

describe('exit-profile', () => {
  it('resolves stratzy_trend book', () => {
    const p = resolveExitProfile('stratzy_trend');
    expect(p.weights[0]).toBe(0.7);
    expect(p.rr).toEqual([0.6, 1.4, 2.2]);
  });

  it('stratzy_trend locks more at T1 than as_planned on giveback path', () => {
    // High only clears Stratzy T1 (0.6R=100.6), not T2 (1.4R=101.4).
    const bars = [
      bar({ time_label: '2024-01-02 10:00', high: 100.7, low: 100.1, close: 100.5 }),
      bar({ time_label: '2024-01-02 10:05', high: 100.5, low: 99.0, close: 99.2 }),
    ];
    const targets = targetsFromProfile(100, 99, true, resolveExitProfile('stratzy_trend'));
    const stratzy = simulateScaledTrade(
      bars,
      100,
      99,
      targets,
      true,
      resolveExitProfile('stratzy_trend'),
    );
    const planned = simulateScaledTrade(
      bars,
      100,
      99,
      targetsFromProfile(100, 99, true),
      true,
      resolveExitProfile('as_planned'),
    );
    // Stratzy: T1 @0.6R × 70% then BE → 0.42R. As-planned: no 1R touch → time/BE path lower or equal.
    expect(stratzy.r).toBeCloseTo(0.42, 5);
    expect(stratzy.path).toContain('T1');
    expect(stratzy.r).toBeGreaterThan(planned.r);
  });
});
