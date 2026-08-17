export interface ScreenerInsightWarning {
  text: string;
  severity: 'critical' | 'watch' | 'info';
  category: string;
  label: string;
}

export interface ScreenerRow {
  symbol: string;
  name: string;
  price: number;
  pe: number;
  roe: number;
  roce: number;
  mos: number | null;
  zone: string;
  recommendation: string;
  composite_score: number;
  verify_score?: number;
  verify_decision?: string;
  verify_cached?: boolean;
  verify_iv?: number;
  iv_delta_pct?: number;
  iv_drift_warn?: boolean;
  parity_from_cache?: boolean;
  score_basis?: 'quality_proxy' | 'full_scorecard';
  recommendation_basis?: 'screening_matrix' | 'full_verify_matrix';
  fair_pe: number;
  method: string;
  intrinsic: number;
  graham?: number;
  final_rating?: string;
  dcf_value?: number;
  pe_intrinsic?: number;
  graham_mos?: number | null;
  graham_credible?: boolean;
  altman_z?: number;
  altman_zone?: string;
  z_score_source?: string;
  altman_skip?: boolean;
  sector_key?: string;
  moat_tier?: string;
  market_cap_cr?: number;
  ta_52w_chart_zone?: string | null;
  ta_bottom_out_score?: number | null;
  promoter_holding?: number;
  promoter_pledge?: number;
  promoter_pledge_as_of?: string;
  passed?: boolean;
  ta_ready?: boolean;
  ta_rsi14?: number | null;
  ta_pct_52w?: number | null;
  ta_bottom_out_hint?: boolean | null;
  ta_above_sma50?: boolean | null;
  ta_macd_hist?: number | null;
  ta_cross_above_sma20?: boolean | null;
  ta_cross_above_sma50?: boolean | null;
  ta_cross_above_sma20_bars?: number | null;
  ta_cross_above_sma50_bars?: number | null;
  ta_cross_above_ema20?: boolean | null;
  ta_cross_below_ema20?: boolean | null;
  ta_cross_above_ema50?: boolean | null;
  ta_cross_below_ema50?: boolean | null;
  ta_cross_above_ema20_bars?: number | null;
  ta_cross_above_ema50_bars?: number | null;
  ta_h_cross_above_ema20?: boolean | null;
  ta_h_cross_above_ema50?: boolean | null;
  ta_h_cross_above_ema20_bars?: number | null;
  ta_h_cross_above_ema50_bars?: number | null;
  sales_yoy?: number;
  div_yield?: number;
  moat_count?: number;
  ta_bb_pct_b?: number | null;
  screener_warnings?: ScreenerInsightWarning[];
  screener_has_critical?: boolean;
  screener_has_watch?: boolean;
  promoter_holding_trend?: string;
  promoter_holding_change_pp?: number;
}

const PITCH_COLUMNS = [
  'symbol',
  'name',
  'verdict',
  'zone',
  'composite_score',
  'verify_score',
  'score_basis',
  'recommendation_basis',
  'mos_pct',
  'fair_pe',
  'valuation_model',
  'pe',
  'roe',
  'roce',
  'promoter_holding',
  'price',
  'daily_cross_sma20',
  'daily_cross_sma50',
  'daily_cross_ema20',
  'daily_cross_ema50',
  'hourly_cross_ema20',
  'hourly_cross_ema50',
] as const;

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function crossExport(value: boolean | null | undefined, bars: number | null | undefined): string {
  if (!value) return '';
  return bars != null ? `Y@${bars}` : 'Y';
}

export function downloadPitchCsv(rows: ScreenerRow[], filename = 'screener-pitch.csv') {
  const lines = [PITCH_COLUMNS.join(',')];
  for (const row of rows) {
    const cells = [
      row.symbol,
      row.name,
      row.recommendation,
      row.zone,
      row.composite_score,
      row.verify_score ?? '',
      row.score_basis ?? '',
      row.recommendation_basis ?? '',
      row.mos !== null ? Math.round(row.mos * 10) / 10 : '',
      row.fair_pe > 0 ? Math.round(row.fair_pe * 10) / 10 : '',
      row.method,
      row.pe,
      row.roe,
      row.roce,
      row.promoter_holding ?? '',
      row.price,
      crossExport(row.ta_cross_above_sma20, row.ta_cross_above_sma20_bars),
      crossExport(row.ta_cross_above_sma50, row.ta_cross_above_sma50_bars),
      crossExport(row.ta_cross_above_ema20, row.ta_cross_above_ema20_bars),
      crossExport(row.ta_cross_above_ema50, row.ta_cross_above_ema50_bars),
      crossExport(row.ta_h_cross_above_ema20, row.ta_h_cross_above_ema20_bars),
      crossExport(row.ta_h_cross_above_ema50, row.ta_h_cross_above_ema50_bars),
    ];
    lines.push(cells.map((c) => csvCell(c)).join(','));
  }
  const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Screening-matrix verdict order (Strong Buy → Reject), aligned with PHP recommendation sort. */
const RECOMMENDATION_RANK: Record<string, number> = {
  'Strong Buy': 70,
  'Buy / SIP': 60,
  'Buy staggered': 55,
  'Hold / small add': 45,
  'Hold only': 40,
  Watchlist: 30,
  Wait: 28,
  'Avoid new': 15,
  Avoid: 10,
  Reject: 0,
  'Need Data': -10,
};

export function recommendationRank(recommendation: string): number {
  return RECOMMENDATION_RANK[recommendation] ?? 20;
}

export type SortKey =
  | 'mos'
  | 'roe'
  | 'roce'
  | 'pe'
  | 'composite_score'
  | 'recommendation'
  | 'symbol'
  | 'sales_yoy'
  | 'div_yield'
  | 'moat_count'
  | 'ta_rsi14'
  | 'ta_pct_52w'
  | 'ta_bb_pct_b'
  | 'ta_macd_hist';

/** PHP ScreenerTaPreset::PRESET_DEFAULT_SORT — preset → sort_by key. */
export const PRESET_DEFAULT_SORT: Record<string, string> = {
  strong_buy: 'recommendation',
  buy_picks: 'recommendation',
  deep_value: 'mos',
  buy_zone: 'mos',
  fair_mos: 'mos',
  near_iv: 'mos',
  value: 'pe_low',
  growth: 'sales_yoy',
  defensive: 'div_yield',
  quality: 'score',
  cfa_top: 'score',
  moat_compounders: 'moat',
  moat_at_value: 'mos',
  monopoly_stocks: 'monopoly',
  ta_technical: 'ta_rsi',
  ta_pullback: 'ta_pct_52w',
  ta_green_dma20: 'ta_pct_52w',
  ta_green_zone: 'ta_pct_52w',
  ta_red_zone: 'ta_pct_52w',
  ta_bottom_out: 'ta_bb',
  ta_golden_cross: 'ta_pct_52w',
  ta_death_cross: 'ta_pct_52w',
  ta_momentum: 'ta_macd',
  ta_oversold: 'mos',
  cfa_moat_bottom: 'mos',
  cfa_moat_reversal: 'ta_macd',
  cfa_moat_uptrend: 'score',
  cfa_best_opportunity: 'recommendation',
  cfa_ltg_conviction: 'recommendation',
  cfa_ltg_auto: 'recommendation',
};

const PHP_SORT_TO_CONFIG: Record<string, { key: SortKey; dir: 'asc' | 'desc' }> = {
  recommendation: { key: 'recommendation', dir: 'desc' },
  mos: { key: 'mos', dir: 'desc' },
  score: { key: 'composite_score', dir: 'desc' },
  pe_low: { key: 'pe', dir: 'asc' },
  sales_yoy: { key: 'sales_yoy', dir: 'desc' },
  div_yield: { key: 'div_yield', dir: 'desc' },
  moat: { key: 'moat_count', dir: 'desc' },
  monopoly: { key: 'moat_count', dir: 'desc' },
  ta_rsi: { key: 'ta_rsi14', dir: 'asc' },
  ta_pct_52w: { key: 'ta_pct_52w', dir: 'asc' },
  ta_bb: { key: 'ta_bb_pct_b', dir: 'asc' },
  ta_macd: { key: 'ta_macd_hist', dir: 'desc' },
};

export function defaultDirForSortKey(key: SortKey): 'asc' | 'desc' {
  if (key === 'symbol' || key === 'pe' || key === 'ta_rsi14' || key === 'ta_pct_52w' || key === 'ta_bb_pct_b') {
    return 'asc';
  }
  return 'desc';
}

export function sortConfigFromPreset(presetId: string): { key: SortKey; dir: 'asc' | 'desc' } {
  const phpKey = PRESET_DEFAULT_SORT[presetId];
  if (phpKey && PHP_SORT_TO_CONFIG[phpKey]) return PHP_SORT_TO_CONFIG[phpKey];
  return { key: 'recommendation', dir: 'desc' };
}

function sortValue(row: ScreenerRow, key: SortKey): number {
  if (key === 'recommendation') return recommendationRank(row.recommendation);
  if (key === 'mos') return row.mos ?? -999;
  if (key === 'ta_rsi14') return row.ta_rsi14 ?? 999;
  if (key === 'ta_pct_52w') return row.ta_pct_52w ?? 999;
  if (key === 'ta_bb_pct_b') return row.ta_bb_pct_b ?? 999;
  if (key === 'ta_macd_hist') return row.ta_macd_hist ?? -999;
  if (key === 'moat_count') return row.moat_count ?? 0;
  if (key === 'sales_yoy') return row.sales_yoy ?? -999;
  if (key === 'div_yield') return row.div_yield ?? 0;
  const raw = row[key as keyof ScreenerRow];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

export function sortRows(rows: ScreenerRow[], key: SortKey, dir: 'asc' | 'desc'): ScreenerRow[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'symbol') return mul * a.symbol.localeCompare(b.symbol);
    return mul * (sortValue(a, key) - sortValue(b, key));
  });
}

export async function downloadJobPitchCsv(jobId: string, filename = 'screener-pitch.csv'): Promise<void> {
  const token = localStorage.getItem('sv_access_token');
  const res = await fetch(`/api/v1/screener/jobs/${encodeURIComponent(jobId)}/export.csv`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.slice(0, 200) || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function badgeClass(zone: string): string {
  if (zone.includes('Buy')) return 'badge badge-buy';
  if (zone === 'Hold' || zone === 'Accumulate') return 'badge badge-hold';
  return 'badge badge-expensive';
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${n.toFixed(1)}%`;
}

export function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}
