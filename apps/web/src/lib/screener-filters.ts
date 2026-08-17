
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

export const RECOMMENDATION_BY_PRESET: Record<string, string> = {
  strong_buy: 'strong_buy',
  buy_picks: 'buy_eligible',
};

export function recommendationFilterFromPreset(
  presetId: string,
  presetFilters?: Record<string, unknown>,
): string {
  if (RECOMMENDATION_BY_PRESET[presetId] !== undefined) return RECOMMENDATION_BY_PRESET[presetId];
  if (Array.isArray(presetFilters?.recommendation_tiers) && presetFilters.recommendation_tiers.length) {
    return '';
  }
  return '';
}

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



export interface ScreenerTaPresetFilters {
  min_rsi: string;
  max_rsi: string;
  min_pct_52w: string;
  max_pct_52w: string;
  min_bb_pct_b: string;
  max_bb_pct_b: string;
  zone_52w: string;
  above_sma20: boolean;
  above_sma50: boolean;
  above_sma200: boolean;
  macd_bullish: boolean;
  below_bb_lower: boolean;
  bottom_out_hint: boolean;
  golden_cross_50_200: boolean;
  death_cross_50_200: boolean;
  golden_cross_9_50: boolean;
  death_cross_9_50: boolean;
  bull_ma_stack: boolean;
  bear_ma_stack: boolean;
}

export const EMPTY_TA_PRESET: ScreenerTaPresetFilters = {
  min_rsi: '',
  max_rsi: '',
  min_pct_52w: '',
  max_pct_52w: '',
  min_bb_pct_b: '',
  max_bb_pct_b: '',
  zone_52w: '',
  above_sma20: false,
  above_sma50: false,
  above_sma200: false,
  macd_bullish: false,
  below_bb_lower: false,
  bottom_out_hint: false,
  golden_cross_50_200: false,
  death_cross_50_200: false,
  golden_cross_9_50: false,
  death_cross_9_50: false,
  bull_ma_stack: false,
  bear_ma_stack: false,
};

const TA_PRESET_BOOL_KEYS = [
  'above_sma20',
  'above_sma50',
  'above_sma200',
  'macd_bullish',
  'below_bb_lower',
  'bottom_out_hint',
  'golden_cross_50_200',
  'death_cross_50_200',
  'golden_cross_9_50',
  'death_cross_9_50',
  'bull_ma_stack',
  'bear_ma_stack',
] as const satisfies ReadonlyArray<keyof ScreenerTaPresetFilters>;

const TA_PRESET_NUM_KEYS = [
  'min_rsi',
  'max_rsi',
  'min_pct_52w',
  'max_pct_52w',
  'min_bb_pct_b',
  'max_bb_pct_b',
] as const satisfies ReadonlyArray<keyof ScreenerTaPresetFilters>;

const ZONE_52W_LABELS: Record<string, string> = {
  green: '52w green zone',
  mid: '52w mid range',
  red: '52w red zone',
};

export function taPresetFromRecord(filters: Record<string, unknown> | undefined): ScreenerTaPresetFilters {
  const out = { ...EMPTY_TA_PRESET };
  if (!filters) return out;
  for (const key of TA_PRESET_NUM_KEYS) {
    if (filters[key] != null && filters[key] !== '') out[key] = String(filters[key]);
  }
  const zone = filters.zone_52w ?? (filters.green_zone_52w ? 'green' : '');
  if (typeof zone === 'string' && zone && zone !== 'any') out.zone_52w = zone;
  for (const key of TA_PRESET_BOOL_KEYS) {
    if (filters[key] === true) out[key] = true;
  }
  return out;
}

export function taPresetFiltersActive(ta?: ScreenerTaPresetFilters): boolean {
  if (!ta) return false;
  for (const key of TA_PRESET_NUM_KEYS) {
    if (parseNum(ta[key]) != null) return true;
  }
  if (ta.zone_52w && ta.zone_52w !== 'any') return true;
  return TA_PRESET_BOOL_KEYS.some((k) => ta[k]);
}

export function buildTaPresetApiFilters(ta: ScreenerTaPresetFilters): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const key of TA_PRESET_NUM_KEYS) {
    const n = parseNum(ta[key]);
    if (n != null) out[key] = n;
  }
  if (ta.zone_52w && ta.zone_52w !== 'any') out.zone_52w = ta.zone_52w;
  for (const key of TA_PRESET_BOOL_KEYS) {
    if (ta[key]) out[key] = true;
  }
  return Object.keys(out).length ? out : undefined;
}

export function buildActiveFilterLabels(input: {
  universeName?: string;
  presetLabel?: string;
  recommendationFilter?: string;
  custom?: ScreenerCustomFilters;
  tech?: ScreenerTechFilters;
  showTa?: boolean;
  excludeRestricted?: boolean;
  taPreset?: ScreenerTaPresetFilters;
  presetHasRecommendationTiers?: boolean;
}): string[] {
  const labels: string[] = [];
  if (input.universeName) labels.push(`Universe: ${input.universeName}`);
  if (input.presetLabel) labels.push(`Preset: ${input.presetLabel}`);

  if (input.recommendationFilter) {
    labels.push(
      `Recommendation: ${RECOMMENDATION_FILTER_OPTIONS[input.recommendationFilter] ?? input.recommendationFilter}`,
    );
  } else if (input.presetHasRecommendationTiers) {
    labels.push('Recommendation: preset tiers');
  }

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


  const tp = input.taPreset;
  if (tp) {
    const minRsi = parseNum(tp.min_rsi);
    const maxRsi = parseNum(tp.max_rsi);
    const minPct = parseNum(tp.min_pct_52w);
    const maxPct = parseNum(tp.max_pct_52w);
    const minBb = parseNum(tp.min_bb_pct_b);
    const maxBb = parseNum(tp.max_bb_pct_b);
    if (minRsi != null) labels.push(`RSI ≥ ${minRsi}`);
    if (maxRsi != null) labels.push(`RSI ≤ ${maxRsi}`);
    if (minPct != null) labels.push(`52w% ≥ ${minPct}`);
    if (maxPct != null) labels.push(`52w% ≤ ${maxPct}`);
    if (minBb != null) labels.push(`BB %B ≥ ${minBb}`);
    if (maxBb != null) labels.push(`BB %B ≤ ${maxBb}`);
    if (tp.zone_52w && tp.zone_52w !== 'any') {
      labels.push(ZONE_52W_LABELS[tp.zone_52w] ?? `52w zone ${tp.zone_52w}`);
    }
    if (tp.above_sma20) labels.push('Above SMA-20');
    if (tp.above_sma50) labels.push('Above SMA-50');
    if (tp.above_sma200) labels.push('Above SMA-200');
    if (tp.macd_bullish) labels.push('MACD bullish');
    if (tp.below_bb_lower) labels.push('Below BB lower');
    if (tp.bottom_out_hint) labels.push('Bottom-out hint');
    if (tp.golden_cross_50_200) labels.push('Golden cross 50/200');
    if (tp.death_cross_50_200) labels.push('Death cross 50/200');
    if (tp.golden_cross_9_50) labels.push('Golden cross 9/50');
    if (tp.death_cross_9_50) labels.push('Death cross 9/50');
    if (tp.bull_ma_stack) labels.push('Bull MA stack');
    if (tp.bear_ma_stack) labels.push('Bear MA stack');
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
