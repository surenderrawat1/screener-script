import { describe, expect, it } from 'vitest';
import {
  applyScreenerWarningsToVerifierAutofill,
  buildScreenerInsights,
  classifyScreenerCons,
  parseScreenerProsCons,
} from './screener-insights.js';

const RELIANCE_FLAGS = `
<div class="pros"><p class="title">Pros</p><ul></ul></div>
<div class="cons"><p class="title">Cons</p><ul>
  <li>Company has a low return on equity of 8.77% over last 3 years.</li>
  <li>Dividend payout has been low at 10.2% of profits over last 3 years</li>
</ul></div>
`;

const HDFCBANK_FLAGS = `
<div class="pros"><p class="title">Pros</p><ul>
  <li>Company has delivered good profit growth of 18.9% CAGR over last 5 years</li>
</ul></div>
<div class="cons"><p class="title">Cons</p><ul>
  <li>Company has low interest coverage ratio.</li>
  <li>Contingent liabilities of Rs.35,61,957 Cr.</li>
  <li>Earnings include an other income of Rs.1,43,700 Cr.</li>
</ul></div>
`;

describe('parseScreenerProsCons', () => {
  it('parses pros and cons bullet lists', () => {
    const { pros, cons } = parseScreenerProsCons(HDFCBANK_FLAGS);
    expect(pros).toHaveLength(1);
    expect(cons).toHaveLength(3);
    expect(cons[0]).toMatch(/interest coverage/i);
  });

  it('handles empty pros', () => {
    const { pros, cons } = parseScreenerProsCons(RELIANCE_FLAGS);
    expect(pros).toHaveLength(0);
    expect(cons).toHaveLength(2);
  });
});

describe('classifyScreenerCons', () => {
  it('assigns severity and category for known patterns', () => {
    const warnings = classifyScreenerCons([
      'Company has a low return on equity of 8.77% over last 3 years.',
      'Company has low interest coverage ratio.',
      'Promoters have pledged 100% of their holding.',
    ]);
    expect(warnings.some((w) => w.category === 'profitability' && w.severity === 'watch')).toBe(true);
    expect(warnings.some((w) => w.category === 'leverage')).toBe(true);
    expect(warnings.some((w) => w.severity === 'critical')).toBe(true);
  });
});

describe('buildScreenerInsights', () => {
  it('sets has_critical when pledge cons present', () => {
    const insights = buildScreenerInsights([], ['Promoters have pledged 100% of their holding.']);
    expect(insights.has_critical).toBe(true);
    expect(insights.warnings[0].severity).toBe('critical');
  });

  it('sets has_watch for HDFCBANK-style cons', () => {
    const { cons } = parseScreenerProsCons(HDFCBANK_FLAGS);
    const insights = buildScreenerInsights([], cons);
    expect(insights.has_watch).toBe(true);
    expect(insights.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('applyScreenerWarningsToVerifierAutofill', () => {
  it('maps HDFCBANK-style cons to Phase 2 soft gates', () => {
    const cons = [
      'Company has low interest coverage ratio.',
      'Contingent liabilities of Rs.35,61,957 Cr.',
      'Earnings include an other income of Rs.1,43,700 Cr.',
    ];
    const warnings = classifyScreenerCons(cons);
    const base = {
      p2_contingent_ok: '1',
      p2_accounting_ok: '1',
      p2_pat_quality: 'yes',
      interest_coverage: 8,
    };
    const { input, adjustments } = applyScreenerWarningsToVerifierAutofill(base, [], warnings);
    expect(input.p2_contingent_ok).toBe('0');
    expect(input.interest_coverage).toBe(2);
    expect(input.p2_pat_quality).toBe('no');
    expect(input.p2_accounting_ok).toBe('0');
    expect(adjustments.length).toBeGreaterThanOrEqual(4);
  });
});
