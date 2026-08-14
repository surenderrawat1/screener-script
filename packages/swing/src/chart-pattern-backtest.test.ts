import { describe, expect, it } from 'vitest';
import { detectChartPatterns } from './chart-patterns.js';
import { attachPatternBacktest, backtestPatternKind } from './chart-pattern-backtest.js';
import type { OhlcBar } from './types.js';

function bar(time: string, open: number, high: number, low: number, close: number, volume = 1_000_000): OhlcBar {
  return { time, open, high, low, close, volume };
}

/** Two double-bottom episodes in one series for walk-forward backtest. */
function repeatedDoubleBottomSeries(): OhlcBar[] {
  const episode = (offset: number, targetRun: 'win' | 'stop') => {
    const bars: OhlcBar[] = [];
    const push = (o: number, h: number, l: number, c: number, v = 1_000_000) => {
      const d = new Date(Date.UTC(2023, 0, 1 + offset + bars.length));
      bars.push(bar(d.toISOString().slice(0, 10), o, h, l, c, v));
    };

    for (let i = 0; i < 35; i++) push(100, 101, 99, 100);
    push(100, 100.5, 90, 91);
    push(91, 92, 89.5, 90.5);
    push(90.5, 91, 89, 90);
    for (let i = 0; i < 8; i++) push(95 + i * 0.8, 96 + i * 0.8, 94 + i * 0.8, 95.5 + i * 0.8);
    push(102, 105, 101, 104);
    push(104, 104, 91, 92);
    push(92, 93, 89.2, 90);
    push(90, 91, 89.5, 90.5);
    push(104, 108, 103, 107, 2_500_000);

    if (targetRun === 'win') {
      for (let i = 0; i < 12; i++) push(108 + i, 110 + i, 107 + i, 109 + i);
    } else {
      for (let i = 0; i < 6; i++) push(105 - i, 106 - i, 84 - i, 85 - i);
    }
    return bars;
  };

  return [...episode(0, 'win'), ...episode(80, 'stop')];
}

describe('chart-pattern-backtest', () => {
  it('returns empty stats when history is too short', () => {
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 50; i++) {
      const d = new Date(Date.UTC(2024, 0, 1 + i));
      bars.push(bar(d.toISOString().slice(0, 10), 100, 101, 99, 100));
    }
    const stat = backtestPatternKind(bars, 'double_bottom');
    expect(stat.occurrences).toBe(0);
    expect(stat.confirmed_breakouts).toBe(0);
  });

  it('finds historical double-bottom instances without look-ahead', () => {
    const bars = repeatedDoubleBottomSeries();
    const stat = backtestPatternKind(bars, 'double_bottom', { min_swing_atr: 0, swing_lookback: 3 }, {
      step_bars: 3,
      forward_horizon_bars: 20,
      min_history_bars: 70,
    });
    expect(stat.occurrences).toBeGreaterThan(0);
    expect(stat.confirmed_breakouts).toBeGreaterThan(0);
    expect(stat.target_hits + stat.stop_hits + stat.unresolved).toBe(stat.confirmed_breakouts);
  });

  it('attaches backtest block to chart pattern result', () => {
    const bars = repeatedDoubleBottomSeries();
    const detected = detectChartPatterns(bars, { min_swing_atr: 0, swing_lookback: 3 });
    const enriched = attachPatternBacktest(bars, detected, { min_swing_atr: 0, swing_lookback: 3 }, {
      min_history_bars: 70,
      step_bars: 3,
    });
    expect(enriched.backtest).toBeTruthy();
    expect(enriched.backtest!.length).toBeGreaterThan(0);
    expect(enriched.backtest![0]!.kind).toBeTruthy();
  });
});
