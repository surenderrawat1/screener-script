import { describe, expect, it } from 'vitest';
import {
  applyPatternIndicatorConfirmation,
  patternIndicatorConfirmation,
} from './chart-pattern-indicators.js';
import type { DetectedPattern } from './chart-patterns.js';
import type { OhlcBar } from './types.js';

function bar(time: string, close: number): OhlcBar {
  return { time, open: close, high: close + 1, low: close - 1, close, volume: 1_000_000 };
}

function samplePattern(type: 'bullish' | 'bearish'): DetectedPattern {
  return {
    id: 'test:1',
    pattern: 'Test',
    kind: 'double_bottom',
    type,
    status: 'forming',
    confidence: 70,
    timeframe: '1D',
    start_date: '2024-01-01',
    end_date: '2024-02-01',
    support: 100,
    resistance: 110,
    breakout: 110,
    target: 120,
    stop_loss: 95,
    volume_confirmed: false,
    points: {},
    detail: 'Test pattern.',
  };
}

describe('chart-pattern-indicators', () => {
  it('boosts bullish confidence when RSI and MACD align', () => {
    const conf = patternIndicatorConfirmation('bullish', 58, 0.5);
    expect(conf.rsi_aligned).toBe(true);
    expect(conf.macd_aligned).toBe(true);
    expect(conf.score_boost).toBe(10);
  });

  it('boosts bearish confidence when RSI and MACD align', () => {
    const conf = patternIndicatorConfirmation('bearish', 40, -0.3);
    expect(conf.rsi_aligned).toBe(true);
    expect(conf.macd_aligned).toBe(true);
    expect(conf.score_boost).toBe(10);
  });

  it('does not boost near-neutral RSI/MACD', () => {
    const conf = patternIndicatorConfirmation('bullish', 50, 0.01);
    expect(conf.rsi_aligned).toBe(false);
    expect(conf.macd_aligned).toBe(false);
    expect(conf.score_boost).toBe(0);
  });

  it('applies boost to detected patterns from bar series', () => {
    const bars: OhlcBar[] = [];
    let price = 100;
    for (let i = 0; i < 40; i++) {
      price += 0.8;
      bars.push(bar(`2024-01-${String(i + 1).padStart(2, '0')}`, price));
    }
    const [enriched] = applyPatternIndicatorConfirmation(bars, [samplePattern('bullish')]);
    expect(enriched!.confidence).toBeGreaterThan(70);
    expect(enriched!.rsi_confirmed || enriched!.macd_confirmed).toBe(true);
  });
});
