import { describe, expect, it } from 'vitest';
import { mergeRatiosWithBulk, parseScreenerBulkTable } from './screener-bulk-table.js';

const FIXTURE = `
<table>
<tr data-row-company-id="123">
  <td>1.</td>
  <td><a href="/company/TCS/consolidated/">Tata Consultancy Services Ltd</a></td>
  <td>3500</td><td>28.5</td><td>1200000</td><td>1.2</td>
  <td>15000</td><td>8.5</td><td>48000</td><td>6.2</td><td>18.5</td>
</tr>
</table>`;

describe('parseScreenerBulkTable', () => {
  it('parses bulk table rows from HTML', () => {
    const rows = parseScreenerBulkTable(FIXTURE);
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe('TCS');
    expect(rows[0].name).toContain('Tata Consultancy');
    expect(rows[0].roce).toBe(18.5);
    expect(rows[0].sales_yoy).toBe(6.2);
  });
});

describe('mergeRatiosWithBulk', () => {
  it('fills missing sales_yoy and market cap from bulk row', () => {
    const merged = mergeRatiosWithBulk(
      {
        roce: 15,
        roe: 20,
        pe: 0,
        book_value: 100,
        sales_yoy: 0,
        profit_yoy: 0,
        debt_to_equity: 0.2,
        market_cap_cr: 0,
      },
      {
        symbol: 'TCS',
        name: 'TCS',
        price: 3500,
        pe: 28,
        market_cap_cr: 1200000,
        div_yield: 1.2,
        profit_yoy: 8.5,
        sales_yoy: 6.2,
        roce: 18.5,
        source: 'screener.in',
      },
    );
    expect(merged.pe).toBe(28);
    expect(merged.market_cap_cr).toBe(1200000);
    expect(merged.sales_yoy).toBe(6.2);
    expect(merged.roce).toBe(15);
  });
});
