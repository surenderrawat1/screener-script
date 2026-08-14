import { describe, expect, it } from 'vitest';
import { swingBacktestSchema, verifyBatchSchema, zone52wSchema } from './schemas.js';

describe('zone52wSchema', () => {
  it('maps low→green and high→red', () => {
    expect(zone52wSchema.parse('low')).toBe('green');
    expect(zone52wSchema.parse('high')).toBe('red');
    expect(zone52wSchema.parse('green')).toBe('green');
  });
});

describe('swingBacktestSchema', () => {
  it('accepts single-symbol backtest with zone aliases', () => {
    const parsed = swingBacktestSchema.parse({
      symbol: 'TCS',
      zone_52w: 'low',
      warmup: 220,
      min_verdict: 'SETUP_PLUS',
    });
    expect(parsed.zone_52w).toBe('green');
    expect(parsed.symbol).toBe('TCS');
  });

  it('rejects warmup outside 100–300', () => {
    expect(swingBacktestSchema.safeParse({ symbol: 'TCS', warmup: 50 }).success).toBe(false);
    expect(swingBacktestSchema.safeParse({ symbol: 'TCS', warmup: 400 }).success).toBe(false);
  });
});

describe('verifyBatchSchema', () => {
  it('accepts symbols[] input', () => {
    const parsed = verifyBatchSchema.parse({ symbols: ['TCS', 'INFY'], refresh: true });
    expect(parsed.symbols?.length).toBe(2);
    expect(parsed.refresh).toBe(true);
  });

  it('accepts universe input', () => {
    const parsed = verifyBatchSchema.parse({ universe: 'nifty50', maxScan: 10 });
    expect(parsed.universe).toBe('nifty50');
    expect(parsed.maxScan).toBe(10);
  });

  it('rejects missing both symbols and universe', () => {
    expect(verifyBatchSchema.safeParse({}).success).toBe(false);
  });
});
