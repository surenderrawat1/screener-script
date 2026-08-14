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
  score_basis?: 'quality_proxy' | 'full_scorecard';
  recommendation_basis?: 'screening_matrix' | 'full_verify_matrix';
  fair_pe: number;
  method: string;
  intrinsic: number;
  promoter_holding?: number;
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

export type SortKey = 'mos' | 'roe' | 'roce' | 'pe' | 'composite_score' | 'symbol';

export function sortRows(rows: ScreenerRow[], key: SortKey, dir: 'asc' | 'desc'): ScreenerRow[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'symbol') return mul * a.symbol.localeCompare(b.symbol);
    const av = a[key] ?? (key === 'mos' ? -999 : 0);
    const bv = b[key] ?? (key === 'mos' ? -999 : 0);
    return mul * (Number(av) - Number(bv));
  });
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
