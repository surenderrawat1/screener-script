/** IV drift helpers — parity with PHP LiveParityChecker. */

export const IV_DRIFT_WARN_PCT = 10;

export function ivDeltaPercent(screenerIv: number, verifyIv: number): number {
  if (verifyIv <= 0 || screenerIv <= 0) return 0;
  return Math.round((Math.abs(screenerIv - verifyIv) / verifyIv) * 1000) / 10;
}

export interface IvDriftHint {
  screener_iv: number;
  full_iv: number;
  drift_pct: number;
  iv_drift_warn: boolean;
}

export function ivDriftHint(screenerIv: number, fullIv: number): IvDriftHint | null {
  if (screenerIv <= 0 || fullIv <= 0) return null;
  const drift_pct = ivDeltaPercent(screenerIv, fullIv);
  return {
    screener_iv: Math.round(screenerIv * 100) / 100,
    full_iv: Math.round(fullIv * 100) / 100,
    drift_pct,
    iv_drift_warn: drift_pct > IV_DRIFT_WARN_PCT,
  };
}
