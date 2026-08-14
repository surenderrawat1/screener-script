/** Acceptance targets from docs/SWING-AUTO.md — “very fast” swing auto. */
export const SLA_INCREMENTAL_SEC = 120;
export const SLA_FULL_SEC = 480;

export type ScanSlaResult = {
  scan_mode: string;
  elapsed_sec: number;
  symbols_scanned: number;
  target_sec: number | null;
  ok: boolean | null;
  label: string;
  summary: string;
};

/**
 * Evaluate last Auto scan against incremental (<2m) / full (<8m) acceptance targets.
 * Returns ok=null when mode is unknown or elapsed missing.
 */
export function evaluateScanSla(
  scanMode: string | null | undefined,
  elapsedSec: number | null | undefined,
  symbolsScanned = 0,
): ScanSlaResult {
  const mode = String(scanMode ?? '').toLowerCase();
  const elapsed = Number(elapsedSec ?? 0);
  const target =
    mode === 'full' ? SLA_FULL_SEC : mode === 'incremental' ? SLA_INCREMENTAL_SEC : null;

  if (target == null || !(elapsed > 0)) {
    return {
      scan_mode: mode || 'unknown',
      elapsed_sec: elapsed,
      symbols_scanned: symbolsScanned,
      target_sec: target,
      ok: null,
      label: 'SLA unknown',
      summary: 'Await a timed Auto scan (elapsed_sec) to score incremental/full SLA.',
    };
  }

  const ok = elapsed <= target;
  const targetMin = Math.round((target / 60) * 10) / 10;
  return {
    scan_mode: mode,
    elapsed_sec: Math.round(elapsed * 10) / 10,
    symbols_scanned: symbolsScanned,
    target_sec: target,
    ok,
    label: ok ? 'SLA pass' : 'SLA miss',
    summary: ok
      ? `${mode} ${elapsed.toFixed(1)}s ≤ ${target}s (${targetMin}m) for ${symbolsScanned || '—'} symbols`
      : `${mode} ${elapsed.toFixed(1)}s > ${target}s (${targetMin}m) target for ${symbolsScanned || '—'} symbols`,
  };
}
