export interface ScreenerCustomFilters {
  min_roe: string;
  min_roce: string;
  min_mos: string;
  max_pe: string;
  min_promoter_holding: string;
}

export interface ScreenerTechFilters {
  fresh_cross_bars: string;
  cross_above_sma20: boolean;
  cross_below_sma20: boolean;
  cross_above_sma50: boolean;
  cross_below_sma50: boolean;
  cross_above_ema20: boolean;
  cross_below_ema20: boolean;
  cross_above_ema50: boolean;
  cross_below_ema50: boolean;
  hourly_cross_above_sma20: boolean;
  hourly_cross_below_sma20: boolean;
  hourly_cross_above_sma50: boolean;
  hourly_cross_below_sma50: boolean;
  hourly_cross_above_ema20: boolean;
  hourly_cross_below_ema20: boolean;
  hourly_cross_above_ema50: boolean;
  hourly_cross_below_ema50: boolean;
}

export const TECH_CROSS_LABELS: Record<keyof Omit<ScreenerTechFilters, 'fresh_cross_bars'>, string> = {
  cross_above_sma20: 'Daily ↑ SMA-20',
  cross_below_sma20: 'Daily ↓ SMA-20',
  cross_above_sma50: 'Daily ↑ SMA-50',
  cross_below_sma50: 'Daily ↓ SMA-50',
  cross_above_ema20: 'Daily ↑ EMA-20',
  cross_below_ema20: 'Daily ↓ EMA-20',
  cross_above_ema50: 'Daily ↑ EMA-50',
  cross_below_ema50: 'Daily ↓ EMA-50',
  hourly_cross_above_sma20: 'Hourly ↑ SMA-20',
  hourly_cross_below_sma20: 'Hourly ↓ SMA-20',
  hourly_cross_above_sma50: 'Hourly ↑ SMA-50',
  hourly_cross_below_sma50: 'Hourly ↓ SMA-50',
  hourly_cross_above_ema20: 'Hourly ↑ EMA-20',
  hourly_cross_below_ema20: 'Hourly ↓ EMA-20',
  hourly_cross_above_ema50: 'Hourly ↑ EMA-50',
  hourly_cross_below_ema50: 'Hourly ↓ EMA-50',
};

function parseNum(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

export function buildActiveFilterLabels(input: {
  universeName?: string;
  presetLabel?: string;
  custom?: ScreenerCustomFilters;
  tech?: ScreenerTechFilters;
  showTa?: boolean;
  excludeRestricted?: boolean;
}): string[] {
  const labels: string[] = [];
  if (input.universeName) labels.push(`Universe: ${input.universeName}`);
  if (input.presetLabel) labels.push(`Preset: ${input.presetLabel}`);

  const c = input.custom;
  if (c) {
    const minRoe = parseNum(c.min_roe);
    const minRoce = parseNum(c.min_roce);
    const minMos = parseNum(c.min_mos);
    const maxPe = parseNum(c.max_pe);
    const minProm = parseNum(c.min_promoter_holding);
    if (minRoe != null) labels.push(`ROE ≥ ${minRoe}%`);
    if (minRoce != null) labels.push(`ROCE ≥ ${minRoce}%`);
    if (minMos != null) labels.push(`MOS ≥ ${minMos}%`);
    if (maxPe != null) labels.push(`P/E ≤ ${maxPe}`);
    if (minProm != null) labels.push(`Promoter ≥ ${minProm}%`);
  }

  const t = input.tech;
  if (t) {
    for (const [key, label] of Object.entries(TECH_CROSS_LABELS)) {
      if (t[key as keyof typeof TECH_CROSS_LABELS]) labels.push(label);
    }
    const anyCross = Object.keys(TECH_CROSS_LABELS).some((k) => t[k as keyof typeof TECH_CROSS_LABELS]);
    if (anyCross) {
      const fresh = parseNum(t.fresh_cross_bars) ?? 3;
      labels.push(`Fresh ≤ ${fresh} bars`);
    }
  }

  if (input.showTa) labels.push('TA columns on');
  if (input.excludeRestricted === false) labels.push('Include ASM/GSM/T2T');
  else if (input.excludeRestricted) labels.push('Exclude restricted');

  return labels;
}

export function techFiltersActive(tech?: ScreenerTechFilters): boolean {
  if (!tech) return false;
  return Object.keys(TECH_CROSS_LABELS).some((k) => tech[k as keyof typeof TECH_CROSS_LABELS]);
}

export function emaColumnsRelevant(tech?: ScreenerTechFilters, showTa?: boolean): boolean {
  if (!showTa && !techFiltersActive(tech)) return false;
  if (!tech) return showTa ?? false;
  return (
    tech.cross_above_ema20 ||
    tech.cross_below_ema20 ||
    tech.cross_above_ema50 ||
    tech.cross_below_ema50 ||
    tech.hourly_cross_above_ema20 ||
    tech.hourly_cross_below_ema20 ||
    tech.hourly_cross_above_ema50 ||
    tech.hourly_cross_below_ema50 ||
    Boolean(showTa)
  );
}

export function hourlyEmaColumnsRelevant(tech?: ScreenerTechFilters): boolean {
  if (!tech) return false;
  return (
    tech.hourly_cross_above_ema20 ||
    tech.hourly_cross_below_ema20 ||
    tech.hourly_cross_above_ema50 ||
    tech.hourly_cross_below_ema50
  );
}
