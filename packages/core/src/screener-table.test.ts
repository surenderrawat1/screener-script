import { describe, expect, it } from 'vitest';
import {
  rowNeedsBulkEnrichment,
  passesTableGates,
  prioritizeUniverseTable,
  shouldBypassTableGatesForTa,
  tablePriorityScore,
} from './screener.js';
import { toPitchCsv } from './screener-export.js';

describe('rowNeedsBulkEnrichment', () => {
  it('flags incomplete ratio rows', () => {
    expect(rowNeedsBulkEnrichment({ sales_yoy: 0, profit_yoy: 0, pe: 12, market_cap_cr: 5000 })).toBe(true);
    expect(rowNeedsBulkEnrichment({ sales_yoy: 8, profit_yoy: 10, pe: 12, market_cap_cr: 5000 })).toBe(false);
  });
});

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

  it('bypasses table gates for TA-only scans without fundamental floor', () => {
    expect(shouldBypassTableGatesForTa({ show_ta: true, max_pe: 999 })).toBe(true);
    expect(passesTableGates({ roce: 1, roe: 1, pe: 200 }, { show_ta: true, max_pe: 999 })).toBe(true);
  });

  it('prioritizes higher-quality table rows first', () => {
    const ordered = prioritizeUniverseTable([
      { symbol: 'LOW', roce: 10, sales_yoy: 5, roe: 8, market_cap_cr: 1000 },
      { symbol: 'HIGH', roce: 30, sales_yoy: 15, roe: 22, market_cap_cr: 50000 },
    ]);
    expect(ordered[0]?.symbol).toBe('HIGH');
    expect(tablePriorityScore(ordered[0]!)).toBeGreaterThan(tablePriorityScore(ordered[1]!));
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
