import { describe, expect, it } from 'vitest';
import { macd } from './ta-helper.js';

describe('macd', () => {
  it('returns finite line, signal, and histogram for sufficient bars', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 2000 + Math.sin(i / 5) * 50);
    const result = macd(closes);
    expect(result).not.toBeNull();
    expect(Number.isFinite(result!.line)).toBe(true);
    expect(Number.isFinite(result!.signal)).toBe(true);
    expect(Number.isFinite(result!.histogram)).toBe(true);
    expect(result!.histogram).toBeCloseTo(result!.line - result!.signal, 3);
  });

  it('returns null when history is too short', () => {
    expect(macd(Array.from({ length: 30 }, (_, i) => 100 + i))).toBeNull();
  });
});
