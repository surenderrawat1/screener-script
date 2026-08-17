import { describe, expect, it } from 'vitest';
import { parseScreenerShareholding, shareholdingVerifierPatches } from './screener-shareholding.js';

const TCS_SHAREHOLDING = `
<section id="shareholding"><table><thead><tr>
  <th></th><th>Dec 2023</th><th>Mar 2024</th><th>Jun 2024</th><th>Sep 2024</th>
</tr></thead><tbody>
  <tr><td class="text">Promoters+</td><td>72.50</td><td>72.30</td><td>72.35</td><td>71.77</td></tr>
  <tr><td class="text">FIIs+</td><td>11.20</td><td>11.80</td><td>12.00</td><td>13.42</td></tr>
  <tr><td class="text">DIIs+</td><td>11.50</td><td>11.20</td><td>11.00</td><td>9.98</td></tr>
  <tr><td class="text">Public+</td><td>5.35</td><td>5.20</td><td>4.95</td><td>4.83</td></tr>
</tbody></table></section>
`;

describe('parseScreenerShareholding', () => {
  it('parses promoter, FII, DII rows and quarter trends', () => {
    const sh = parseScreenerShareholding(TCS_SHAREHOLDING);
    expect(sh).not.toBeNull();
    expect(sh?.latest_period).toBe('Sep 2024');
    expect(sh?.promoter?.latest_pct).toBe(71.77);
    expect(sh?.promoter?.prev_pct).toBe(72.35);
    expect(sh?.promoter?.change_pp).toBe(-0.58);
    expect(sh?.promoter?.trend).toBe('declining');
    expect(sh?.fii?.trend).toBe('increasing');
    expect(sh?.dii?.trend).toBe('declining');
    expect(sh?.categories).toHaveLength(4);
  });

  it('returns null when shareholding section missing', () => {
    expect(parseScreenerShareholding('<html></html>')).toBeNull();
  });
});

describe('shareholdingVerifierPatches', () => {
  it('flags declining promoter for Phase 1 stable gate', () => {
    const sh = parseScreenerShareholding(TCS_SHAREHOLDING);
    const patches = shareholdingVerifierPatches(sh);
    expect(patches.some((p) => p.field === 'p1_promoter_stable' && p.value === 'no')).toBe(true);
    expect(patches.some((p) => p.field === 'mr_business_vs_sentiment')).toBe(true);
  });
});
