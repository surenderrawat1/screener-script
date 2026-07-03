import { describe, expect, it } from 'vitest';
import { enrichMetricsFromScreenerAnnual, parseScreenerAnnualFinancials } from './screener-annual.js';
import { buildStockMetrics } from '@sv/core';

const TCS_HTML_SNIPPET = `
<meta name="description" content="TCS · Mkt Cap: 7,48,257 Crore · Promoter Holding: 71.8%">
<p>
  <a href="/market/IN08/" title="Sector">Information Technology</a>
  <a href="/market/IN08/IN0801/IN080101/" title="Industry">Computers - Software &amp; Consulting</a>
</p>
<section id="profit-loss"><table><thead><tr><th></th><th>Mar 2024</th><th>Mar 2025</th></tr></thead><tbody>
<tr><td class="text">Sales</td><td>240000</td><td>267021</td></tr>
<tr><td class="text">Operating Profit</td><td>65000</td><td>72398</td></tr>
<tr><td class="text">OPM %</td><td>27%</td><td>27%</td></tr>
<tr><td class="text">OPM %</td><td>27%</td></tr>
<tr><td class="text">Net Profit</td><td>46000</td><td>49454</td></tr>
<tr><td class="text">EPS in Rs</td><td>126</td><td>136</td></tr>
</tbody></table></section>
<section id="balance-sheet"><table><thead><tr><th></th><th>Mar 2025</th></tr></thead><tbody>
<tr><td class="text">Equity Capital</td><td>362</td></tr>
<tr><td class="text">Reserves</td><td>158287</td></tr>
<tr><td class="text">Borrowings</td><td>11283</td></tr>
<tr><td class="text">Investments</td><td>45000</td></tr>
<tr><td class="text">Total Assets</td><td>200000</td></tr>
</tbody></table></section>
<section id="cash-flow"><table><thead><tr><th></th><th>Mar 2025</th></tr></thead><tbody>
<tr><td class="text">Cash from Operating Activity</td><td>52094</td></tr>
<tr><td class="text">Free Cash Flow</td><td>48013</td></tr>
</tbody></table></section>
`;

describe('parseScreenerAnnualFinancials', () => {
  it('parses EPS, cash flow, debt, margin, cash, sector, industry, and promoter from screener', () => {
    const parsed = parseScreenerAnnualFinancials(TCS_HTML_SNIPPET);
    expect(parsed.revenue_history).toEqual([240000, 267021]);
    expect(parsed.pat_history).toEqual([46000, 49454]);
    expect(parsed.eps_consolidated).toBe(136);
    expect(parsed.ebitda_margin_pct).toBe(27);
    expect(parsed.cfo_cr).toBe(52094);
    expect(parsed.fcf_cr).toBe(48013);
    expect(parsed.capex_cr).toBe(4081);
    expect(parsed.total_debt_cr).toBe(11283);
    expect(parsed.total_cash_cr).toBe(45000);
    expect(parsed.sector_label).toBe('Information Technology');
    expect(parsed.industry).toBe('Computers - Software & Consulting');
    expect(parsed.promoter_holding_pct).toBe(71.8);
    expect(parsed.shareholders_equity_cr).toBe(158649);
    expect(parsed.operating_margin_pct).toBe(27);
    expect(parsed.roa_pct).toBe(24.73);
    expect(parsed.debt_to_equity).toBe(0.0711);
  });
});

describe('enrichMetricsFromScreenerAnnual', () => {
  it('fills missing Yahoo fields for Phase 2 / 4 autofill', () => {
    const base = buildStockMetrics('TCS', { price: 2093, pe: 14.4, market_cap_cr: 760000 });
    const enriched = enrichMetricsFromScreenerAnnual(base, {
      revenue_history: [240000, 267021],
      pat_history: [49454],
      shareholders_equity_cr: 90000,
      summary: '',
      eps_consolidated: 136,
      ebitda_margin_pct: 27.1,
      cfo_cr: 52094,
      fcf_cr: 48013,
      capex_cr: 4081,
      total_debt_cr: 11283,
      total_cash_cr: 45000,
    });
    expect(enriched.eps).toBe(136);
    expect(enriched.ebitda_margin).toBe(27.1);
    expect(enriched.cfo_cr).toBe(52094);
    expect(enriched.fcf_cr).toBe(48013);
    expect(enriched.total_debt_cr).toBe(11283);
    expect(enriched.total_cash_cr).toBe(45000);
  });
});
