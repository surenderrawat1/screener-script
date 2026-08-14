import { describe, expect, it } from 'vitest';
import { evaluateScanSla, SLA_FULL_SEC, SLA_INCREMENTAL_SEC } from './scan-sla.js';

describe('scan SLA', () => {
  it('passes incremental under 2 minutes', () => {
    const r = evaluateScanSla('incremental', 95, 60);
    expect(r.ok).toBe(true);
    expect(r.target_sec).toBe(SLA_INCREMENTAL_SEC);
    expect(r.label).toBe('SLA pass');
  });

  it('fails full over 8 minutes', () => {
    const r = evaluateScanSla('full', SLA_FULL_SEC + 1, 250);
    expect(r.ok).toBe(false);
    expect(r.label).toBe('SLA miss');
  });

  it('unknown when elapsed missing', () => {
    expect(evaluateScanSla('full', 0, 250).ok).toBeNull();
  });
});
