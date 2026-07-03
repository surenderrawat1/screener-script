import type { ScreenerRow } from '@sv/shared';

/** Stable pitch CSV columns (subset of PHP NseStockScreener::PITCH_CSV_COLUMNS). */
export const PITCH_CSV_COLUMNS = [
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

export type PitchCsvColumn = (typeof PITCH_CSV_COLUMNS)[number];

export function screenerRowToPitch(row: ScreenerRow): Record<PitchCsvColumn, string | number> {
  return {
    symbol: row.symbol,
    name: row.name,
    verdict: row.recommendation,
    zone: row.zone,
    composite_score: row.composite_score,
    mos_pct: row.mos !== null ? Math.round(row.mos * 10) / 10 : '',
    fair_pe: row.fair_pe > 0 ? Math.round(row.fair_pe * 10) / 10 : '',
    valuation_model: row.method,
    pe: row.pe,
    roe: row.roe,
    roce: row.roce,
    promoter_holding: row.promoter_holding ?? '',
    price: row.price,
  };
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toPitchCsv(rows: ScreenerRow[]): string {
  const lines = [PITCH_CSV_COLUMNS.join(',')];
  for (const row of rows) {
    const pitch = screenerRowToPitch(row);
    lines.push(PITCH_CSV_COLUMNS.map((col) => csvCell(pitch[col])).join(','));
  }
  return `${lines.join('\n')}\n`;
}
