import { describe, expect, it } from 'vitest';
import {
  enrichLtgRow,
  ltgGuidanceFromSummary,
  passesRecommendationTiers,
  recommendationTierFromVerdict,
} from './ltg-auto-decision.js';

describe('recommendationTierFromVerdict', () => {
  it('maps screening matrix verdicts', () => {
    expect(recommendationTierFromVerdict('Strong Buy')).toBe('strong_buy');
    expect(recommendationTierFromVerdict('Buy / SIP')).toBe('buy');
    expect(recommendationTierFromVerdict('Reject')).toBe('avoid');
  });
});

describe('passesRecommendationTiers', () => {
  it('filters buy-eligible tiers', () => {
    expect(passesRecommendationTiers('Strong Buy', ['strong_buy', 'buy'])).toBe(true);
    expect(passesRecommendationTiers('Avoid', ['strong_buy', 'buy'])).toBe(false);
  });
});

describe('enrichLtgRow', () => {
  it('scores strong moat compounder as accumulate or core', () => {
    const row = enrichLtgRow({
      symbol: 'TCS',
      recommendation: 'Strong Buy',
      composite_score: 82,
      mos: 12,
      moat_tier: 'strong',
      sales_yoy: 10,
      roce: 22,
      roe: 24,
    });
    expect(row.decision_score).toBeGreaterThan(60);
    expect(['CORE_LTG', 'ACCUMULATE']).toContain(row.decision_action);
  });
});

describe('ltgGuidanceFromSummary', () => {
  it('warns when no hits', () => {
    const g = ltgGuidanceFromSummary({ passed: 0, scanned: 250, high_conviction: 0, strict_enter: 0 });
    expect(g.tone).toBe('warning');
    expect(g.deploy_pct).toBe(0);
  });
});
