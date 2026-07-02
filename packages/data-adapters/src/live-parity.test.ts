import { describe, expect, it } from 'vitest';
import { ivDeltaPercent, ivDriftHint, IV_DRIFT_WARN_PCT } from './live-parity.js';

describe('live-parity', () => {
  it('returns zero delta when IVs invalid', () => {
    expect(ivDeltaPercent(0, 100)).toBe(0);
    expect(ivDeltaPercent(100, 0)).toBe(0);
  });

  it('flags drift warn above 10%', () => {
    const hint = ivDriftHint(900, 1000);
    expect(hint?.drift_pct).toBe(10);
    expect(hint?.iv_drift_warn).toBe(false);

    const warn = ivDriftHint(850, 1000);
    expect(warn?.drift_pct).toBe(15);
    expect(warn?.iv_drift_warn).toBe(true);
    expect(IV_DRIFT_WARN_PCT).toBe(10);
  });
});
