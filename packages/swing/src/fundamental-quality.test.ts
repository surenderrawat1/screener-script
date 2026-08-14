import { describe, expect, it } from 'vitest';
import {
  applyFundamentalQuality,
  fundamentalQuality,
  isFinancialQualitySector,
  MIN_ROE_PCT,
  MIN_ROCE_PCT,
} from './fundamental-quality.js';

describe('fundamentalQuality', () => {
  it('passes when ROE and ROCE both ≥ 15%', () => {
    const q = fundamentalQuality({ roe: 28, roce: 22 });
    expect(q.ok).toBe(true);
    expect(q.status).toBe('pass');
    expect(q.min_roe_pct).toBe(MIN_ROE_PCT);
    expect(q.min_roce_pct).toBe(MIN_ROCE_PCT);
    expect(q.roce_waived).toBe(false);
  });

  it('fails when either ratio is below 15%', () => {
    expect(fundamentalQuality({ roe: 14, roce: 20 }).ok).toBe(false);
    expect(fundamentalQuality({ roe: 20, roce: 14 }).risk_flags).toContain('LOW_ROCE');
    expect(fundamentalQuality({ roe: 10, roce: 10 }).risk_flags).toContain('QUALITY_FAIL');
  });

  it('marks unknown when metrics missing', () => {
    const q = fundamentalQuality({ roe: 0, roce: 0 });
    expect(q.status).toBe('unknown');
    expect(q.ok).toBe(false);
  });

  it('demotes strict ENTER when quality fails', () => {
    const hit = applyFundamentalQuality(
      { symbol: 'XYZ', strict_verdict: 'ENTER', strict_enter_ready: true, verdict: 'ENTER' },
      { roe: 8, roce: 9 },
    );
    expect(hit.strict_verdict).toBe('WATCH');
    expect(hit.strict_enter_ready).toBe(false);
    expect(hit.fundamental_quality_ok).toBe(false);
  });

  it('detects financial sectors for ROCE waiver', () => {
    expect(isFinancialQualitySector('Financial Services', 'Banks')).toBe(true);
    expect(isFinancialQualitySector('NBFC', '')).toBe(true);
    expect(isFinancialQualitySector('IT', 'Software')).toBe(false);
    expect(isFinancialQualitySector('general', '', 'HDFCBANK')).toBe(true);
    expect(isFinancialQualitySector('general', '', 'SBIN')).toBe(true);
  });

  it('waives ROCE for banks when ROE ≥ 15%', () => {
    const q = fundamentalQuality({ roe: 16, roce: 4, sector: 'Financial Services', industry: 'Banks' });
    expect(q.ok).toBe(true);
    expect(q.roce_waived).toBe(true);
    expect(q.risk_flags).not.toContain('LOW_ROCE');
    expect(q.summary).toMatch(/waived/i);
  });

  it('waives ROCE via NSE sector hint when Yahoo sector is general', () => {
    const q = fundamentalQuality({ roe: 15.4, roce: 6.1, sector: 'general', symbol: 'SBIN' });
    expect(q.ok).toBe(true);
    expect(q.roce_waived).toBe(true);
  });

  it('fails banks on low ROE even if ROCE waived', () => {
    const q = fundamentalQuality({ roe: 10, roce: 0, sector: 'banking' });
    expect(q.ok).toBe(false);
    expect(q.roce_waived).toBe(true);
    expect(q.risk_flags).toContain('LOW_ROE');
  });

  it('allows bank pass with ROE only (no ROCE data)', () => {
    const q = fundamentalQuality({ roe: 18, roce: 0, sector: 'Banking' });
    expect(q.ok).toBe(true);
    expect(q.status).toBe('pass');
  });

  it('fails HDFCBANK-style sub-15 ROE even with hint', () => {
    const q = fundamentalQuality({ roe: 13.6, roce: 7, sector: 'general', symbol: 'HDFCBANK' });
    expect(q.ok).toBe(false);
    expect(q.roce_waived).toBe(true);
    expect(q.risk_flags).toContain('LOW_ROE');
  });
});
