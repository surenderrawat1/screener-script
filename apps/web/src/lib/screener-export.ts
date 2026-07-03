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
  fair_pe: number;
  method: string;
  intrinsic: number;
  promoter_holding?: number;
  passed?: boolean;
  ta_ready?: boolean;
  ta_rsi14?: number | null;
  ta_pct_52w?: number | null;
  ta_bottom_out_hint?: boolean | null;
}

const PITCH_COLUMNS = [
  'symbol',
  'name',
  'verdict',
  'zone',
  'composite_score',
  'mos_pct',
  'fair_pe',
  'valuation_model',
  'pe',
  'roe',
  'roce',
  'promoter_holding',
  'price',
] as const;

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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
      row.mos !== null ? Math.round(row.mos * 10) / 10 : '',
      row.fair_pe > 0 ? Math.round(row.fair_pe * 10) / 10 : '',
      row.method,
      row.pe,
      row.roe,
      row.roce,
      row.promoter_holding ?? '',
      row.price,
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
