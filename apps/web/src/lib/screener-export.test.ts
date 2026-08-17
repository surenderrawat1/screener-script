import { describe, expect, it } from 'vitest';
import { sortConfigFromPreset, sortRows } from './screener-export.js';

describe('screener sort', () => {
  it('maps presets to PHP default sort', () => {
    expect(sortConfigFromPreset('deep_value')).toEqual({ key: 'mos', dir: 'desc' });
    expect(sortConfigFromPreset('value')).toEqual({ key: 'pe', dir: 'asc' });
    expect(sortConfigFromPreset('ta_technical')).toEqual({ key: 'ta_rsi14', dir: 'asc' });
  });

  it('sorts sales YoY descending', () => {
    const rows = sortRows(
      [
        { symbol: 'A', sales_yoy: 5 } as import('./screener-export.js').ScreenerRow,
        { symbol: 'B', sales_yoy: 20 } as import('./screener-export.js').ScreenerRow,
      ],
      'sales_yoy',
      'desc',
    );
    expect(rows[0].symbol).toBe('B');
  });
});
