import { describe, expect, it } from 'vitest';
import {
  isBuyEligibleRecommendation,
  passesRecommendationFilter,
  resolveRecommendationFilter,
} from './screener-recommendation-filter.js';

describe('screener recommendation filter', () => {
  it('resolves preset tiers when filter empty', () => {
    expect(
      resolveRecommendationFilter('', 'cfa_ltg_auto', {
        recommendation_tiers: ['strong_buy', 'buy'],
      }),
    ).toBe('preset');
    expect(resolveRecommendationFilter('', 'strong_buy', {})).toBe('strong_buy');
    expect(resolveRecommendationFilter('watchlist', 'strong_buy', {})).toBe('watchlist');
  });

  it('passes buy_eligible and tier filters', () => {
    expect(passesRecommendationFilter({ recommendation: 'Strong Buy' }, 'strong_buy')).toBe(true);
    expect(passesRecommendationFilter({ recommendation: 'Buy / SIP' }, 'strong_buy')).toBe(false);
    expect(passesRecommendationFilter({ recommendation: 'Buy staggered' }, 'buy_eligible')).toBe(true);
    expect(passesRecommendationFilter({ recommendation: 'Watchlist' }, 'buy_eligible')).toBe(false);
    expect(
      passesRecommendationFilter({ recommendation: 'Buy / SIP' }, 'preset', ['strong_buy', 'buy']),
    ).toBe(true);
    expect(isBuyEligibleRecommendation('Hold / small add')).toBe(false);
  });
});
