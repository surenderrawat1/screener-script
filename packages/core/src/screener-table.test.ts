import { describe, expect, it } from 'vitest';
import { passesTableGates } from './screener.js';
import { toPitchCsv } from './screener-export.js';

describe('passesTableGates', () => {
  it('rejects low ROCE before full fetch', () => {
    expect(passesTableGates({ roce: 10, roe: 20, pe: 15 }, { min_roce: 12 })).toBe(false);
  });

  it('rejects high P/E', () => {
    expect(passesTableGates({ roce: 20, roe: 18, pe: 35 }, { max_pe: 20 })).toBe(false);
  });

  it('rejects low market cap', () => {
    expect(
      passesTableGates({ roce: 20, roe: 18, pe: 18, market_cap_cr: 1000 }, { min_mcap_cr: 3000 }),
    ).toBe(false);
  });

  it('passes when ratios meet preset', () => {
    expect(passesTableGates({ roce: 18, roe: 20, pe: 18 }, { min_roe: 15, min_roce: 12, max_pe: 25 })).toBe(
      true,
    );
  });
});

describe('toPitchCsv', () => {
  it('emits header and row', () => {
    const csv = toPitchCsv([
      {
        symbol: 'TCS',
        name: 'TCS',
        price: 100,
        pe: 20,
        roe: 25,
        roce: 30,
        mos: 12.5,
        zone: 'Buy',
        action: 'buy',
        recommendation: 'Buy',
        composite_score: 72,
        fair_pe: 22,
        method: 'dcf',
        graham: 80,
        intrinsic: 112,
        passed: true,
      },
    ]);
    expect(csv.startsWith('symbol,name,verdict')).toBe(true);
    expect(csv).toContain('TCS');
    expect(csv).toContain('12.5');
  });
});
