export type EconStatus = 'pass' | 'fail' | 'unproven' | 'missing' | null | undefined;

/** Map swing hit backtest fields to economic gate chip status. */
export function econFromSwingHit(hit: {
  backtest_grade?: string;
  net_edge_ok?: boolean;
  backtest_trades?: number;
  backtest_pf?: number | null;
}): EconStatus {
  const grade = String(hit.backtest_grade ?? '').toLowerCase();
  const n = Number(hit.backtest_trades ?? 0);
  if (!grade || n === 0) return 'missing';
  if (n < 10) return 'unproven';
  if (grade === 'fail' || grade === 'weak') return 'fail';
  if (hit.net_edge_ok === true && (grade === 'strong' || grade === 'ok')) return 'pass';
  if (hit.net_edge_ok === false) return 'fail';
  return 'unproven';
}

export function crossFlag(value: boolean | null | undefined, bars: number | null | undefined): string {
  if (!value) return '';
  return bars != null ? `Y@${bars}` : 'Y';
}
