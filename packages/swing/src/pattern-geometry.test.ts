import { describe, expect, it } from 'vitest';
import { formatRewardRisk, patternRewardRisk } from './pattern-geometry.js';

describe('patternRewardRisk', () => {
  it('computes absolute R multiple from breakout geometry', () => {
    expect(patternRewardRisk(100, 112, 96)).toBe(3);
    expect(patternRewardRisk(100, 88, 104)).toBe(3);
  });

  it('returns null when levels incomplete', () => {
    expect(patternRewardRisk(100, null, 96)).toBeNull();
    expect(patternRewardRisk(100, 112, 100)).toBeNull();
  });

  it('formats display', () => {
    expect(formatRewardRisk(3)).toBe('3.0R');
    expect(formatRewardRisk(null)).toBe('—');
  });
});
