import { buildActiveFilterLabels, type ScreenerCustomFilters, type ScreenerTaPresetFilters, type ScreenerTechFilters } from '../../lib/screener-filters';

export function ActiveFilterStrip({
  universeName,
  presetLabel,
  custom,
  tech,
  taPreset,
  showTa,
  excludeRestricted,
  recommendationFilter,
  presetHasRecommendationTiers,
}: {
  universeName?: string;
  presetLabel?: string;
  custom?: ScreenerCustomFilters;
  tech?: ScreenerTechFilters;
  taPreset?: ScreenerTaPresetFilters;
  showTa?: boolean;
  excludeRestricted?: boolean;
  recommendationFilter?: string;
  presetHasRecommendationTiers?: boolean;
}) {
  const labels = buildActiveFilterLabels({
    universeName,
    presetLabel,
    custom,
    tech,
    taPreset,
    showTa,
    excludeRestricted,
    recommendationFilter,
    presetHasRecommendationTiers,
  });

  if (labels.length === 0) return null;

  return (
    <div className="active-filter-strip" aria-label="Active screener filters">
      <span className="active-filter-strip-label">Active filters</span>
      <ul className="active-filter-strip-list">
        {labels.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
    </div>
  );
}
