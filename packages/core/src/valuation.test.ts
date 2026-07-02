import { describe, expect, it } from 'vitest';
import { calculateFairPe, grahamNumber, mosFromIntrinsic, mosZone } from '../src/valuation.js';
import { screenSymbol } from '../src/screener.js';

describe('valuation', () => {
  it('computes MOS from intrinsic', () => {
    expect(mosFromIntrinsic(100, 75)).toBe(25);
  });

  it('graham number', () => {
    expect(grahamNumber(10, 100)).toBeCloseTo(150, 0);
  });

  it('fair pe for IT sector', () => {
    const r = calculateFairPe(12, { sector: 'IT', roe: 25, roce: 22 });
    expect(r.fair_pe).toBeGreaterThan(14);
    expect(r.fair_pe).toBeLessThanOrEqual(32);
  });

  it('mos zones', () => {
    expect(mosZone(30)).toBe('Buy');
    expect(mosZone(-5)).toBe('Expensive');
  });
});

describe('screener', () => {
  it('screens TCS with sample data', () => {
    const row = screenSymbol('TCS');
    expect(row.symbol).toBe('TCS');
    expect(row.mos).not.toBeNull();
    expect(row.recommendation).toBeTruthy();
  });
});
