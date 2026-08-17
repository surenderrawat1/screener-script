import { describe, expect, it } from 'vitest';
import { inferAnnualReportGates, mergeAnnualReportGates } from './annual-report.js';

describe('inferAnnualReportGates', () => {
  it('healthy stock passes annual report inference', () => {
    const good = inferAnnualReportGates(
      {
        cfo_cr: 1000,
        pat_cr: 1200,
        revenue_history: [100, 110, 125, 140],
        revenue_growth: 12,
        screener_meta: 'Steady growth',
      },
      { about: 'Expanding capacity', key_points: 'Strong order book' },
    );
    expect(good.annual_report.score).toBeGreaterThanOrEqual(3);
    expect(good.gates.p2_accounting_ok).toBe('1');
    expect(good.annual_report.status).toBe('pass');
    expect(good.annual_report.profile_loaded).toBe(true);
  });

  it('weak fundamentals + litigation fails AR scan', () => {
    const bad = inferAnnualReportGates(
      {
        cfo_cr: 200,
        pat_cr: 1000,
        revenue_history: [200, 180, 160, 140],
        revenue_growth: -8,
      },
      { key_points: 'SEBI order pending litigation' },
    );
    expect(bad.annual_report.score).toBeLessThan(3);
    expect(bad.gates.p2_contingent_ok).toBe('');
    expect(bad.gates.p2_accounting_ok).toBe('');
  });

  it('notes when profile is not loaded', () => {
    const r = inferAnnualReportGates({
      cfo_cr: 500,
      pat_cr: 400,
      revenue_history: [100, 110, 120],
      revenue_growth: 8,
    });
    expect(r.annual_report.profile_loaded).toBe(false);
    expect(r.annual_report.checks.auditor.note).toMatch(/Profile not loaded/);
  });
});

describe('mergeAnnualReportGates', () => {
  it('preserves screener explicit fails', () => {
    const merged = mergeAnnualReportGates(
      {
        p2_auditor_clean: '0',
        p2_contingent_ok: '1',
        p2_chairman_honest: '1',
        p2_accounting_ok: '1',
      },
      {
        p2_chairman_honest: '1',
        p2_auditor_clean: '1',
        p2_contingent_ok: '',
        p2_accounting_ok: '1',
      },
    );
    expect(merged.p2_auditor_clean).toBe('0');
    expect(merged.p2_contingent_ok).toBe('');
  });
});
