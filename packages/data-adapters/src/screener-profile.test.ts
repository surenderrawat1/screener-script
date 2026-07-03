import { describe, expect, it } from 'vitest';
import { parseScreenerProfileHtml } from './screener-profile.js';

const CASH_FLOW_SNIPPET = `
<section id="cash-flow">
<table class="data-table">
<thead><tr><th></th><th>Mar 2024</th><th>Mar 2025</th></tr></thead>
<tbody>
<tr><td class="text">Cash from Operating Activity +</td><td>45000</td><td>52000</td></tr>
<tr><td class="text">Cash from Investing Activity +</td><td>-12000</td><td>-15000</td></tr>
<tr><td class="text">Depreciation</td><td>4000</td><td>4200</td></tr>
</tbody>
</table>
</section>
`;

describe('parseScreenerProfileHtml expenditures', () => {
  it('matches Screener row labels with trailing plus', () => {
    const profile = parseScreenerProfileHtml(CASH_FLOW_SNIPPET);
    const labels = profile.expenditures.items.map((i) => i.label);
    expect(labels).toContain('Cash from Operating Activity');
    expect(labels).toContain('Cash from Investing Activity');
    expect(labels).toContain('Depreciation');
    const cfo = profile.expenditures.items.find((i) => i.label === 'Cash from Operating Activity');
    expect(cfo?.latest_cr).toBe(52000);
  });
});
