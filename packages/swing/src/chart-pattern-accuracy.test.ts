import { describe, expect, it } from 'vitest';
import {
  detectFailedBreakout,
  patternTrendContext,
  refinePatternsForAccuracy,
  rewardRisk,
  scorePatternConfidence,
  volumeConfirmedRecent,
} from './chart-pattern-accuracy.js';
import { DEFAULT_PATTERN_CONFIG, type DetectedPattern } from './chart-patterns.js';
import type { OhlcBar } from './types.js';

function bar(time: string, close: number, high?: number, low?: number, volume = 1_000_000): OhlcBar {
  return {
    time,
    open: close,
    high: high ?? close + 1,
    low: low ?? close - 1,
    close,
    volume,
  };
}

function sample(partial: Partial<DetectedPattern> = {}): DetectedPattern {
  return {
    id: 'double_bottom:a:b',
    pattern: 'Double Bottom',
    kind: 'double_bottom',
    type: 'bullish',
    status: 'confirmed',
    confidence: 78,
    timeframe: '1D',
    start_date: '2024-01-01',
    end_date: '2024-03-01',
    support: 100,
    resistance: 110,
    breakout: 110,
    target: 130,
    stop_loss: 100,
    volume_confirmed: false,
    points: { geometry_score: 0.9 },
    detail: 'Test.',
    ...partial,
  };
}

describe('chart-pattern-accuracy', () => {
  it('scores confidence with doc §9 weights', () => {
    const high = scorePatternConfidence({
      geometryScore: 1,
      status: 'confirmed',
      volumeOk: true,
      trendScore: 1,
      structureScore: 1,
    });
    const low = scorePatternConfidence({
      geometryScore: 0.4,
      status: 'forming',
      volumeOk: false,
      trendScore: 0.15,
      structureScore: 0.3,
    });
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(90);
    expect(low).toBeLessThanOrEqual(68);
  });

  it('computes reward:risk from measured move', () => {
    expect(rewardRisk(sample())).toBe(2);
    expect(rewardRisk(sample({ target: 110.2, stop_loss: 109 }))).toBeLessThan(1);
  });

  it('detects failed breakout after reclaim', () => {
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 10; i++) bars.push(bar(`2024-01-${String(i + 1).padStart(2, '0')}`, 108));
    bars.push(bar('2024-01-11', 112, 113, 111)); // beyond 110 + buffer
    bars.push(bar('2024-01-12', 112, 113, 111));
    bars.push(bar('2024-01-13', 108, 109, 107)); // reclaim
    expect(detectFailedBreakout(bars, 'confirmed', 110, 'above', 0.005)).toBe(true);
    expect(detectFailedBreakout(bars, 'forming', 110, 'above', 0.005)).toBe(false);
  });

  it('requires volume for confirmed status when configured', () => {
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 40; i++) {
      bars.push(bar(`2024-01-${String(i + 1).padStart(2, '0')}`, 100 + i * 0.2, undefined, undefined, 500_000));
    }
    // Quiet breakout close above 110
    bars.push(bar('2024-02-10', 112, 113, 111, 400_000));
    const refined = refinePatternsForAccuracy(
      bars,
      [sample({ status: 'confirmed', volume_confirmed: false, breakout: 110 })],
      { ...DEFAULT_PATTERN_CONFIG, require_volume_for_confirm: true },
    );
    expect(refined[0]?.status).toBe('breakout');
    expect(refined[0]?.volume_confirmed).toBe(false);
  });

  it('keeps volume-backed confirms', () => {
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 40; i++) {
      bars.push(bar(`2024-01-${String(i + 1).padStart(2, '0')}`, 100 + i * 0.15, undefined, undefined, 500_000));
    }
    bars.push(bar('2024-02-10', 112, 113, 111, 2_000_000));
    expect(volumeConfirmedRecent(bars, 110, 'above', 0.005, 1.2)).toBe(true);
    const refined = refinePatternsForAccuracy(
      bars,
      [sample({ status: 'confirmed', breakout: 110 })],
      DEFAULT_PATTERN_CONFIG,
    );
    expect(refined[0]?.status).toBe('confirmed');
    expect(refined[0]?.volume_confirmed).toBe(true);
    expect(refined[0]?.points.reward_risk).toBeTruthy();
  });

  it('marks bullish trend when price is above EMA-21 / SMA-50', () => {
    const bars: OhlcBar[] = [];
    let px = 100;
    for (let i = 0; i < 60; i++) {
      px += 0.5;
      bars.push(bar(`d-${i}`, px));
    }
    const ctx = patternTrendContext(bars, 'bullish');
    expect(ctx.aligned).toBe(true);
    expect(ctx.score).toBeGreaterThanOrEqual(0.65);
  });

  it('drops thin R:R noise', () => {
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 40; i++) bars.push(bar(`d-${i}`, 100 + i * 0.1));
    bars.push(bar('d-40', 112, 113, 111, 2_000_000));
    const refined = refinePatternsForAccuracy(
      bars,
      [sample({ target: 110.2, stop_loss: 100, breakout: 110 })],
      { ...DEFAULT_PATTERN_CONFIG, min_reward_risk: 1.5 },
    );
    // Target only ~0.18% beyond entry — noise, dropped.
    expect(refined).toHaveLength(0);
  });

  it('demotes confirmed when R:R is below floor but target is meaningful', () => {
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 40; i++) bars.push(bar(`d-${i}`, 100 + i * 0.1));
    bars.push(bar('d-40', 112, 113, 111, 2_000_000));
    const refined = refinePatternsForAccuracy(
      bars,
      [sample({ target: 115, stop_loss: 100, breakout: 110 })],
      { ...DEFAULT_PATTERN_CONFIG, min_reward_risk: 1.5 },
    );
    expect(refined).toHaveLength(1);
    expect(refined[0]?.status).toBe('breakout');
    expect(Number(refined[0]?.points.reward_risk)).toBeLessThan(1.5);
  });
});
