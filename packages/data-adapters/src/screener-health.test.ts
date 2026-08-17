import { describe, expect, it } from 'vitest';
import { screenerHtmlRowCount, summarizeScreenerHealth } from './screener-health.js';

describe('summarizeScreenerHealth', () => {
  it('returns healthy when no samples yet', () => {
    expect(summarizeScreenerHealth(null).healthy).toBe(true);
    expect(summarizeScreenerHealth(null).pages).toBe(0);
  });

  it('flags stress when failure rate is high', () => {
    const summary = summarizeScreenerHealth({
      pages: 20,
      failures: 6,
      empty_pages: 2,
      rows: 12,
      last_at: '2026-08-14T00:00:00.000Z',
    });
    expect(summary.failure_rate).toBe(0.3);
    expect(summary.healthy).toBe(false);
  });

  it('stays healthy below PHP thresholds', () => {
    const summary = summarizeScreenerHealth({
      pages: 100,
      failures: 10,
      empty_pages: 20,
      rows: 70,
      last_at: '2026-08-14T00:00:00.000Z',
    });
    expect(summary.failure_rate).toBe(0.1);
    expect(summary.empty_rate).toBe(0.2);
    expect(summary.healthy).toBe(true);
  });
});

describe('screenerHtmlRowCount', () => {
  it('detects ratio rows in fixture html', () => {
    const html = `${'x'.repeat(220)}<span class="name">ROCE </span><span class="number">18.5</span>`;
    expect(screenerHtmlRowCount(html)).toBe(1);
  });

  it('returns 0 for empty or broken html', () => {
    expect(screenerHtmlRowCount('')).toBe(0);
    expect(screenerHtmlRowCount('<html>login</html>')).toBe(0);
  });
});
