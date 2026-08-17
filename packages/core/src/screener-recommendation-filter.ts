import { recommendationTierFromVerdict, type LtgRecommendationTier } from './ltg-auto-decision.js';
import type { ScreenerFilters } from './screener-presets.js';

/** UI labels — PHP NseStockScreener::RECOMMENDATION_FILTERS parity. */
export const RECOMMENDATION_FILTER_OPTIONS: Record<string, string> = {
  '': 'All passing stocks',
  buy_eligible: 'Buy eligible only (Strong Buy + Buy + Staggered)',
  strong_buy: 'Strong Buy only',
  buy: 'Buy only',
  buy_staggered: 'Staggered Buy only',
  watchlist: 'Watchlist',
  hold: 'Hold / Small Add',
  avoid: 'Avoid',
};

/** Preset key → default recommendation_filter (screener.php applyPreset). */
export const RECOMMENDATION_BY_PRESET: Record<string, string> = {
  strong_buy: 'strong_buy',
  buy_picks: 'buy_eligible',
};

const BUY_ELIGIBLE_TIERS: LtgRecommendationTier[] = ['strong_buy', 'buy', 'buy_staggered'];

export function isBuyEligibleRecommendation(recommendation: string): boolean {
  const tier = recommendationTierFromVerdict(recommendation);
  return BUY_ELIGIBLE_TIERS.includes(tier);
}

export function resolveRecommendationFilter(
  explicitFilter: string | undefined,
  presetKey?: string,
  presetFilters?: ScreenerFilters,
): string {
  const trimmed = (explicitFilter ?? '').trim();
  if (trimmed) return trimmed;
  const byPreset = presetKey ? RECOMMENDATION_BY_PRESET[presetKey] : undefined;
  if (byPreset) return byPreset;
  if (presetFilters?.recommendation_tiers?.length) return 'preset';
  return '';
}

export function passesRecommendationFilter(
  row: { recommendation?: string },
  filter: string,
  presetTiers?: string[],
): boolean {
  if (!filter) return true;

  const tier = recommendationTierFromVerdict(String(row.recommendation ?? ''));

  if (filter === 'preset') {
    if (!presetTiers?.length) return true;
    return presetTiers.includes(tier);
  }

  if (filter === 'buy_eligible') {
    return isBuyEligibleRecommendation(String(row.recommendation ?? ''));
  }

  return tier === filter;
}

export function recommendationFilterLabel(filter: string): string | undefined {
  if (!filter || filter === 'preset') return undefined;
  return RECOMMENDATION_FILTER_OPTIONS[filter];
}
