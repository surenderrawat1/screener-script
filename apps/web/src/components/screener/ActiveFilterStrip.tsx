import { buildActiveFilterLabels, type ScreenerCustomFilters, type ScreenerTechFilters } from '../../lib/screener-filters';

export function ActiveFilterStrip({
  universeName,
  presetLabel,
  custom,
  tech,
  showTa,
  excludeRestricted,
}: {
  universeName?: string;
  presetLabel?: string;
  custom?: ScreenerCustomFilters;
  tech?: ScreenerTechFilters;
  showTa?: boolean;
  excludeRestricted?: boolean;
}) {
  const labels = buildActiveFilterLabels({
    universeName,
    presetLabel,
    custom,
    tech,
    showTa,
    excludeRestricted,
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
