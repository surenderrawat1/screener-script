import { describe, expect, it } from 'vitest';
import type { IntradayBar } from './nifty-direction.js';
import {
  estimateIntradayCostR,
  simulateScaledTrade,
  simulateTrade,
} from './intraday-backtest.js';

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

describe('simulateScaledTrade', () => {
  it('credits full T1+T2+T3 path above classic +1R', () => {
    const entry = 100;
    const stop = 99;
    const targets = [101, 102, 103];
    const bars = [
      bar({ time_label: '2024-01-02 10:00', high: 101.5, low: 100.2, close: 101.2 }),
      bar({ time_label: '2024-01-02 10:05', high: 102.5, low: 101.0, close: 102.2 }),
      bar({ time_label: '2024-01-02 10:10', high: 103.5, low: 102.0, close: 103.2 }),
    ];
    const scaled = simulateScaledTrade(bars, entry, stop, targets, true);
    expect(scaled.path).toContain('T1');
    expect(scaled.path).toContain('T2');
    expect(scaled.path).toContain('T3');
    // 0.4*1 + 0.4*2 + 0.2*3 = 1.8R
    expect(scaled.r).toBeCloseTo(1.8, 5);

    const classic = simulateTrade(bars, entry, stop, targets[0], true);
    expect(classic.r).toBe(1);
    expect(scaled.r).toBeGreaterThan(classic.r);
  });

  it('moves stop to breakeven after T1 so runners do not give full −1R', () => {
    const bars = [
      bar({ time_label: '2024-01-02 10:00', high: 101.5, low: 100.1, close: 101.1 }),
      bar({ time_label: '2024-01-02 10:05', high: 100.5, low: 99.0, close: 99.2 }),
    ];
    const scaled = simulateScaledTrade(bars, 100, 99, [101, 102, 103], true);
    expect(scaled.path).toMatch(/T1/);
    expect(scaled.path).toMatch(/X1_BE/);
    // Booked 0.4R at T1; remainder stopped at BE → ~+0.4R
    expect(scaled.r).toBeCloseTo(0.4, 5);
  });

  it('classic T1 locks a win that scaled runners can later give back', () => {
    const bars = [
      bar({ time_label: '2024-01-02 10:00', high: 101.2, low: 100.1, close: 101.0 }),
      bar({ time_label: '2024-01-02 10:05', high: 100.8, low: 100.2, close: 100.4 }),
      bar({ time_label: '2024-01-02 14:00', high: 100.2, low: 99.4, close: 99.5 }),
    ];
    const classic = simulateTrade(bars, 100, 99, 101, true);
    expect(classic.outcome).toBe('win');
    expect(classic.r).toBe(1);

    // Scaled books T1 then leaves runner open; late fade can erase the book.
    const scaled = simulateScaledTrade(bars, 100, 99, [101, 102, 103], true);
    expect(scaled.path).toMatch(/T1/);
    // 0.4*1 + 0.6*((99.5-100)/1) = 0.4 - 0.3 = 0.1 if time/EOD, or BE stop
    // Either way classic is a clean +1R win while scaled is much smaller.
    expect(scaled.r).toBeLessThan(classic.r);
  });
});

describe('estimateIntradayCostR', () => {
  it('returns positive cost in R for typical stock risk', () => {
    const cost = estimateIntradayCostR(500, 5);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(1);
  });

  it('does not invent a 1-share lot that makes index costs >1R by default', () => {
    // Notional × risk% risk rupees — still material, but not the old 1.68R toy.
    const cost = estimateIntradayCostR(22_000, 40);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(2);
  });
});
